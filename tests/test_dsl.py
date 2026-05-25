import pandas as pd
import pytest

from backtesting.dsl import compile_expr


def _ctx(**series):
    return {k: pd.Series(v, dtype="float64") for k, v in series.items()}


def test_compare_constants():
    f = compile_expr("rsi < 30")
    out = f(_ctx(rsi=[10, 30, 50]))
    assert list(out) == [True, False, False]


def test_and_or_not():
    f = compile_expr("(a > 0 AND b < 0) OR NOT (c == 0)")
    out = f(_ctx(a=[1, -1, 1], b=[-1, 1, -1], c=[0, 0, 1]))
    # row0: (T and T) or NOT(T)=F → T;  row1: (F and F)=F or NOT(T)=F → F; row2: (T and T)=T → T
    assert list(out) == [True, False, True]


def test_arithmetic():
    f = compile_expr("close * 1.05 > high")
    out = f(_ctx(close=[100, 100], high=[104, 106]))
    assert list(out) == [True, False]


def test_dotted_ref():
    f = compile_expr("macd.macd > macd.signal")
    out = f({"macd.macd": pd.Series([1.0, 2.0]), "macd.signal": pd.Series([0.5, 3.0])})
    assert list(out) == [True, False]


def test_cross_above():
    f = compile_expr("cross_above(ema_fast, ema_slow)")
    out = f(_ctx(ema_fast=[1, 2, 3, 4], ema_slow=[5, 4, 3, 3]))
    # crossover quando fast passa da <=slow a >slow: i=3 (3<=3 e 4>3) → True
    assert list(out) == [False, False, False, True]


def test_cross_below():
    f = compile_expr("cross_below(a, b)")
    out = f(_ctx(a=[5, 4, 3, 2], b=[1, 2, 3, 3]))
    # i=3: a[2]=3 >= b[2]=3 e a[3]=2 < b[3]=3 → True
    assert list(out) == [False, False, False, True]


def test_unknown_identifier_raises():
    with pytest.raises(KeyError):
        compile_expr("zzz > 0")(_ctx(rsi=[1, 2]))


def test_unknown_function_raises():
    with pytest.raises(ValueError):
        compile_expr("foo(rsi, 1)")(_ctx(rsi=[1, 2]))


def test_precedence():
    f = compile_expr("a + b * 2 > 10")
    out = f(_ctx(a=[1, 5], b=[3, 3]))
    # row0: 1+6=7 >10 → F; row1: 5+6=11 >10 → T
    assert list(out) == [False, True]
