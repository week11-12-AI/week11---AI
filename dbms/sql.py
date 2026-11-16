"""Tokenize SQL into a small AST without eval or string interpolation."""
import math
import re
from .errors import check, DBError

TOKEN = re.compile(r"\s+|'(?:[^']|'')*'|[a-zA-Z_][a-zA-Z_0-9]*|-?\d+(?:\.\d+)?|[(),=*;?]")
MISSING = object()


def finite_number(value):
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def tokenize(sql, params):
    check(isinstance(sql, str) and 0 < len(sql) <= 1_000_000, "SQL_SYNTAX", "SQL은 1~1,000,000자여야 합니다.")
    check(isinstance(params, list), "SQL_PARAMS", "params는 배열이어야 합니다.")
    tokens, offset, parameter = [], 0, 0
    while offset < len(sql):
        match = TOKEN.match(sql, offset)
        check(match is not None, "SQL_SYNTAX", f"{offset + 1}번째 문자 근처의 SQL을 해석할 수 없습니다.")
        raw, offset = match.group(), match.end()
        if raw.isspace():
            continue
        if raw == "?":
            check(parameter < len(params), "SQL_PARAMS", "SQL 매개변수가 부족합니다.")
            value = params[parameter]
            parameter += 1
            check(value is None or isinstance(value, str) or finite_number(value), "SQL_PARAMS", "문자열·유한 숫자·null만 사용할 수 있습니다.")
            tokens.append(("value", value))
        elif raw.startswith("'"):
            tokens.append(("value", raw[1:-1].replace("''", "'")))
        elif raw[0].isdigit() or raw[0] == "-":
            try:
                value = float(raw) if "." in raw else int(raw)
                check(finite_number(value), "SQL_SYNTAX", "숫자 범위를 초과했습니다.")
            except ValueError:
                raise DBError("SQL_SYNTAX", "숫자 범위를 초과했습니다.") from None
            tokens.append(("value", value))
        elif raw.lower() == "null":
            tokens.append(("value", None))
        else:
            tokens.append(("word" if raw[0].isalpha() or raw[0] == "_" else "symbol", raw.lower()))
    check(parameter == len(params), "SQL_PARAMS", "사용되지 않은 SQL 매개변수가 있습니다.")
    return tokens


class Parser:
    def __init__(self, tokens):
        self.tokens, self.index = tokens, 0

    def accept(self, value):
        if self.index < len(self.tokens) and self.tokens[self.index][0] != "value" and self.tokens[self.index][1] == value:
            self.index += 1
            return True
        return False

    def expect(self, value):
        check(self.accept(value), "SQL_SYNTAX", f"'{value}'가 필요합니다.")

    def take(self, kind):
        check(self.index < len(self.tokens) and self.tokens[self.index][0] == kind, "SQL_SYNTAX", "SQL 이름 또는 값이 올바르지 않습니다.")
        value = self.tokens[self.index][1]
        self.index += 1
        return value

    def name(self):
        return self.take("word")

    def value(self):
        return self.take("value")

    def comma_list(self, read):
        result = [read()]
        while self.accept(","):
            result.append(read())
        return result

    def where(self):
        column = self.name()
        self.expect("=")
        return {"column": column, "value": self.value()}

    def values(self):
        self.expect("(")
        row = self.comma_list(self.value)
        self.expect(")")
        return row

    def order(self):
        column = self.name()
        direction = -1 if self.accept("desc") else 1
        if direction == 1:
            self.accept("asc")
        return {"column": column, "direction": direction}

    def assignment(self):
        column = self.name()
        self.expect("=")
        return column, self.value()

    def parse(self):
        kind = self.name()
        if kind == "insert":
            self.expect("into")
            table = self.name()
            self.expect("(")
            columns = self.comma_list(self.name)
            self.expect(")")
            self.expect("values")
            rows = self.comma_list(self.values)
            check(len(rows) <= 5000, "SQL_LIMIT", "한 INSERT는 최대 5,000행입니다.")
            check(len(set(columns)) == len(columns), "SQL_SYNTAX", "중복 컬럼입니다.")
            check(all(len(row) == len(columns) for row in rows), "SQL_SYNTAX", "컬럼과 값의 개수가 다릅니다.")
            ast = dict(type=kind, table=table, columns=columns, rows=rows)
        elif kind == "select":
            columns = ["*"] if self.accept("*") else self.comma_list(self.name)
            self.expect("from")
            ast = dict(type=kind, table=self.name(), columns=columns, where=self.where() if self.accept("where") else None, order=[], limit=100)
            if self.accept("order"):
                self.expect("by")
                ast["order"] = self.comma_list(self.order)
            if self.accept("limit"):
                ast["limit"] = self.value()
            check(type(ast["limit"]) is int and 1 <= ast["limit"] <= 1000, "SQL_LIMIT", "LIMIT은 1~1,000입니다.")
        elif kind == "update":
            table = self.name()
            self.expect("set")
            changes = self.comma_list(self.assignment)
            check(len({key for key, _ in changes}) == len(changes), "SQL_SYNTAX", "중복 컬럼입니다.")
            self.expect("where")
            ast = dict(type=kind, table=table, changes=changes, where=self.where())
        elif kind == "delete":
            self.expect("from")
            table = self.name()
            self.expect("where")
            ast = dict(type=kind, table=table, where=self.where())
        else:
            raise DBError("SQL_UNSUPPORTED", "INSERT, SELECT, UPDATE, DELETE만 지원합니다.")
        self.accept(";")
        check(self.index == len(self.tokens), "SQL_SYNTAX", "지원하지 않는 구문 또는 여러 SQL문입니다.")
        return ast


def parse_sql(sql, params=MISSING):
    return Parser(tokenize(sql, [] if params is MISSING else params)).parse()
