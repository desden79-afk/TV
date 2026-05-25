"""Mini-linguaggio per le regole di entry/exit di una strategia.

Esempio:
    "rsi < 30 AND ema_fast > ema_slow"
    "cross_above(macd.macd, macd.signal)"

L'espressione viene tokenizzata, parsata in un AST e compilata in una
funzione che opera su pandas.Series (vettoriale). Per ogni bar restituisce
un valore booleano o numerico. La compilazione avviene una volta sola; il
motore di backtest poi indicizza le serie risultanti.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Callable

import numpy as np
import pandas as pd

# ---------- Tokenizer ----------

TOKEN_SPEC = [
    ("NUMBER",   r"\d+(?:\.\d+)?"),
    ("IDENT",    r"[A-Za-z_][A-Za-z_0-9]*"),
    ("OP",       r"<=|>=|==|!=|<|>|\+|\-|\*|/"),
    ("DOT",      r"\."),
    ("LPAREN",   r"\("),
    ("RPAREN",   r"\)"),
    ("COMMA",    r","),
    ("WS",       r"\s+"),
]
TOKEN_RE = re.compile("|".join(f"(?P<{name}>{pat})" for name, pat in TOKEN_SPEC))
KEYWORDS = {"AND", "OR", "NOT"}


@dataclass
class Token:
    kind: str
    value: str


def tokenize(src: str) -> list[Token]:
    out: list[Token] = []
    pos = 0
    while pos < len(src):
        m = TOKEN_RE.match(src, pos)
        if not m:
            raise ValueError(f"Carattere non riconosciuto a posizione {pos}: {src[pos]!r}")
        kind = m.lastgroup
        value = m.group()
        pos = m.end()
        if kind == "WS":
            continue
        if kind == "IDENT" and value.upper() in KEYWORDS:
            out.append(Token(value.upper(), value.upper()))
        else:
            out.append(Token(kind, value))
    out.append(Token("EOF", ""))
    return out


# ---------- AST ----------

@dataclass
class Number:
    value: float


@dataclass
class Ref:
    name: str
    sub: str | None = None  # es. macd.macd


@dataclass
class BinaryOp:
    op: str
    left: Any
    right: Any


@dataclass
class UnaryOp:
    op: str
    expr: Any


@dataclass
class FuncCall:
    name: str
    args: list[Any]


# ---------- Parser ----------

class Parser:
    def __init__(self, tokens: list[Token]):
        self.toks = tokens
        self.i = 0

    def peek(self) -> Token:
        return self.toks[self.i]

    def eat(self, kind: str | None = None, value: str | None = None) -> Token:
        t = self.toks[self.i]
        if kind and t.kind != kind:
            raise ValueError(f"Atteso {kind} ma trovato {t.kind} ({t.value!r})")
        if value and t.value != value:
            raise ValueError(f"Atteso {value!r} ma trovato {t.value!r}")
        self.i += 1
        return t

    def parse(self):
        node = self.parse_or()
        self.eat("EOF")
        return node

    def parse_or(self):
        node = self.parse_and()
        while self.peek().kind == "OR":
            self.eat("OR")
            node = BinaryOp("OR", node, self.parse_and())
        return node

    def parse_and(self):
        node = self.parse_not()
        while self.peek().kind == "AND":
            self.eat("AND")
            node = BinaryOp("AND", node, self.parse_not())
        return node

    def parse_not(self):
        if self.peek().kind == "NOT":
            self.eat("NOT")
            return UnaryOp("NOT", self.parse_not())
        return self.parse_cmp()

    def parse_cmp(self):
        node = self.parse_add()
        if self.peek().kind == "OP" and self.peek().value in ("<", "<=", ">", ">=", "==", "!="):
            op = self.eat("OP").value
            right = self.parse_add()
            node = BinaryOp(op, node, right)
        return node

    def parse_add(self):
        node = self.parse_mul()
        while self.peek().kind == "OP" and self.peek().value in ("+", "-"):
            op = self.eat("OP").value
            node = BinaryOp(op, node, self.parse_mul())
        return node

    def parse_mul(self):
        node = self.parse_unary()
        while self.peek().kind == "OP" and self.peek().value in ("*", "/"):
            op = self.eat("OP").value
            node = BinaryOp(op, node, self.parse_unary())
        return node

    def parse_unary(self):
        if self.peek().kind == "OP" and self.peek().value == "-":
            self.eat("OP")
            return UnaryOp("-", self.parse_unary())
        return self.parse_atom()

    def parse_atom(self):
        t = self.peek()
        if t.kind == "NUMBER":
            self.eat("NUMBER")
            return Number(float(t.value))
        if t.kind == "LPAREN":
            self.eat("LPAREN")
            node = self.parse_or()
            self.eat("RPAREN")
            return node
        if t.kind == "IDENT":
            name = self.eat("IDENT").value
            if self.peek().kind == "LPAREN":
                self.eat("LPAREN")
                args = []
                if self.peek().kind != "RPAREN":
                    args.append(self.parse_or())
                    while self.peek().kind == "COMMA":
                        self.eat("COMMA")
                        args.append(self.parse_or())
                self.eat("RPAREN")
                return FuncCall(name, args)
            sub = None
            if self.peek().kind == "DOT":
                self.eat("DOT")
                sub = self.eat("IDENT").value
            return Ref(name, sub)
        raise ValueError(f"Token inatteso: {t.kind} {t.value!r}")


def parse(src: str):
    return Parser(tokenize(src)).parse()


# ---------- Evaluator (vettoriale, su pandas.Series) ----------

def _to_series(x: Any, length: int) -> pd.Series:
    if isinstance(x, pd.Series):
        return x
    return pd.Series([x] * length, dtype="float64")


def _eval(node: Any, ctx: dict[str, pd.Series]) -> pd.Series:
    n = len(next(iter(ctx.values())))

    if isinstance(node, Number):
        return pd.Series([node.value] * n, dtype="float64")

    if isinstance(node, Ref):
        key = node.name if node.sub is None else f"{node.name}.{node.sub}"
        if key not in ctx:
            raise KeyError(f"Identificatore sconosciuto: {key}")
        return ctx[key]

    if isinstance(node, UnaryOp):
        v = _eval(node.expr, ctx)
        if node.op == "-":
            return -v
        if node.op == "NOT":
            return ~v.astype(bool)
        raise ValueError(f"Operatore unario non supportato: {node.op}")

    if isinstance(node, BinaryOp):
        l = _eval(node.left, ctx)
        r = _eval(node.right, ctx)
        op = node.op
        if op == "+":  return l + r
        if op == "-":  return l - r
        if op == "*":  return l * r
        if op == "/":  return l / r
        if op == "<":  return l < r
        if op == "<=": return l <= r
        if op == ">":  return l > r
        if op == ">=": return l >= r
        if op == "==": return l == r
        if op == "!=": return l != r
        if op == "AND": return l.astype(bool) & r.astype(bool)
        if op == "OR":  return l.astype(bool) | r.astype(bool)
        raise ValueError(f"Operatore binario non supportato: {op}")

    if isinstance(node, FuncCall):
        if node.name == "cross_above":
            if len(node.args) != 2:
                raise ValueError("cross_above richiede 2 argomenti")
            a = _eval(node.args[0], ctx)
            b = _eval(node.args[1], ctx)
            return (a.shift(1) <= b.shift(1)) & (a > b)
        if node.name == "cross_below":
            if len(node.args) != 2:
                raise ValueError("cross_below richiede 2 argomenti")
            a = _eval(node.args[0], ctx)
            b = _eval(node.args[1], ctx)
            return (a.shift(1) >= b.shift(1)) & (a < b)
        raise ValueError(f"Funzione sconosciuta: {node.name}")

    raise TypeError(f"Nodo AST non riconosciuto: {type(node).__name__}")


def compile_expr(src: str) -> Callable[[dict[str, pd.Series]], pd.Series]:
    """Compila un'espressione DSL: ritorna una funzione che, dato un context
    di pandas.Series, restituisce la serie risultato (boolean o numerica)."""
    ast = parse(src)

    def evaluator(ctx: dict[str, pd.Series]) -> pd.Series:
        result = _eval(ast, ctx)
        return result.fillna(False) if result.dtype == bool else result.replace([np.inf, -np.inf], np.nan)

    return evaluator
