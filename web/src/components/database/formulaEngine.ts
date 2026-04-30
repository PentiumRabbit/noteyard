/**
 * formulaEngine.ts — 手写递归下降公式解析器
 *
 * 支持：
 *   - prop("列名")              引用同行其他列的值
 *   - 四则运算 + - * /，括号分组
 *   - 比较运算 > < >= <= == !=，返回 boolean
 *   - 字符串字面量 "..." 或 '...'
 *   - 数值字面量（整数/小数）
 *   - 布尔字面量 true / false
 *   - 函数调用：IF / CONCAT / ROUND / ABS / NOT（大小写不敏感）
 */

type FormulaValue = number | string | boolean;

// ─── Lexer ────────────────────────────────────────────────────────────────────

type TokenKind =
  | "NUM"
  | "STR"
  | "BOOL"
  | "IDENT"
  | "LPAREN"
  | "RPAREN"
  | "COMMA"
  | "PLUS"
  | "MINUS"
  | "STAR"
  | "SLASH"
  | "GT"
  | "LT"
  | "GTE"
  | "LTE"
  | "EQ"
  | "NEQ"
  | "EOF";

interface Token {
  kind: TokenKind;
  value: string;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    // Whitespace
    if (/\s/.test(ch)) { i++; continue; }

    // Number
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(input[i + 1] ?? ""))) {
      let num = "";
      while (i < input.length && /[0-9.]/.test(input[i])) num += input[i++];
      tokens.push({ kind: "NUM", value: num });
      continue;
    }

    // String literal " or '
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let str = "";
      i++; // skip opening quote
      while (i < input.length && input[i] !== quote) {
        if (input[i] === "\\" && i + 1 < input.length) {
          i++; // skip backslash
          str += input[i++];
        } else {
          str += input[i++];
        }
      }
      i++; // skip closing quote
      tokens.push({ kind: "STR", value: str });
      continue;
    }

    // Identifier or keyword
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = "";
      while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) ident += input[i++];
      const upper = ident.toUpperCase();
      if (upper === "TRUE" || upper === "FALSE") {
        tokens.push({ kind: "BOOL", value: upper });
      } else {
        tokens.push({ kind: "IDENT", value: ident });
      }
      continue;
    }

    // Two-char comparison operators (must be checked before single-char)
    if (ch === ">" && input[i + 1] === "=") {
      tokens.push({ kind: "GTE", value: ">=" }); i += 2; continue;
    }
    if (ch === "<" && input[i + 1] === "=") {
      tokens.push({ kind: "LTE", value: "<=" }); i += 2; continue;
    }
    if (ch === "=" && input[i + 1] === "=") {
      tokens.push({ kind: "EQ", value: "==" }); i += 2; continue;
    }
    if (ch === "!" && input[i + 1] === "=") {
      tokens.push({ kind: "NEQ", value: "!=" }); i += 2; continue;
    }

    // Single-char tokens
    switch (ch) {
      case "(": tokens.push({ kind: "LPAREN", value: ch }); break;
      case ")": tokens.push({ kind: "RPAREN", value: ch }); break;
      case ",": tokens.push({ kind: "COMMA",  value: ch }); break;
      case "+": tokens.push({ kind: "PLUS",   value: ch }); break;
      case "-": tokens.push({ kind: "MINUS",  value: ch }); break;
      case "*": tokens.push({ kind: "STAR",   value: ch }); break;
      case "/": tokens.push({ kind: "SLASH",  value: ch }); break;
      case ">": tokens.push({ kind: "GT",     value: ch }); break;
      case "<": tokens.push({ kind: "LT",     value: ch }); break;
      default:
        throw new Error(`Unexpected character: ${ch}`);
    }
    i++;
  }

  tokens.push({ kind: "EOF", value: "" });
  return tokens;
}

// ─── Parser / Evaluator ───────────────────────────────────────────────────────

class Parser {
  private tokens: Token[];
  private pos = 0;
  private row: { cells: Record<string, string> };
  private columns: { id: string; name: string; type: string }[];

  constructor(
    tokens: Token[],
    row: { cells: Record<string, string> },
    columns: { id: string; name: string; type: string }[],
  ) {
    this.tokens = tokens;
    this.row = row;
    this.columns = columns;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private consume(): Token {
    return this.tokens[this.pos++];
  }

  private expect(kind: TokenKind): Token {
    const tok = this.consume();
    if (tok.kind !== kind) throw new Error(`Expected ${kind}, got ${tok.kind}`);
    return tok;
  }

  // expression = comparison
  parseExpression(): FormulaValue {
    return this.parseComparison();
  }

  // comparison = additive (('>' | '<' | '>=' | '<=' | '==' | '!=') additive)*
  private parseComparison(): FormulaValue {
    let left = this.parseAdditive();

    const compOps: TokenKind[] = ["GT", "LT", "GTE", "LTE", "EQ", "NEQ"];
    while (compOps.includes(this.peek().kind)) {
      const op = this.consume().kind;
      const right = this.parseAdditive();

      const l = toNumber(left);
      const r = toNumber(right);

      switch (op) {
        case "GT":  left = l > r;  break;
        case "LT":  left = l < r;  break;
        case "GTE": left = l >= r; break;
        case "LTE": left = l <= r; break;
        case "EQ":  left = left === right; break;
        case "NEQ": left = left !== right; break;
      }
    }

    return left;
  }

  // additive = multiplicative (('+' | '-') multiplicative)*
  private parseAdditive(): FormulaValue {
    let left = this.parseMultiplicative();

    while (this.peek().kind === "PLUS" || this.peek().kind === "MINUS") {
      const op = this.consume().kind;
      const right = this.parseMultiplicative();

      if (op === "PLUS") {
        // If either side is a string, coerce to string concatenation
        if (typeof left === "string" || typeof right === "string") {
          left = String(left) + String(right);
        } else if (typeof left === "number" && typeof right === "number") {
          left = left + right;
        } else {
          left = String(left) + String(right);
        }
      } else {
        left = toNumber(left) - toNumber(right);
      }
    }

    return left;
  }

  // multiplicative = unary (('*' | '/') unary)*
  private parseMultiplicative(): FormulaValue {
    let left = this.parseUnary();

    while (this.peek().kind === "STAR" || this.peek().kind === "SLASH") {
      const op = this.consume().kind;
      const right = this.parseUnary();

      if (op === "STAR") {
        left = toNumber(left) * toNumber(right);
      } else {
        const divisor = toNumber(right);
        left = divisor === 0 ? "#DIV/0" : toNumber(left) / divisor;
      }
    }

    return left;
  }

  // unary = '-' unary | primary
  private parseUnary(): FormulaValue {
    if (this.peek().kind === "MINUS") {
      this.consume();
      return -toNumber(this.parseUnary());
    }
    return this.parsePrimary();
  }

  // primary = NUM | STR | BOOL | '(' expression ')' | funcCall | prop
  private parsePrimary(): FormulaValue {
    const tok = this.peek();

    if (tok.kind === "NUM") {
      this.consume();
      return parseFloat(tok.value);
    }

    if (tok.kind === "STR") {
      this.consume();
      return tok.value;
    }

    if (tok.kind === "BOOL") {
      this.consume();
      return tok.value === "TRUE";
    }

    if (tok.kind === "LPAREN") {
      this.consume(); // '('
      const val = this.parseExpression();
      this.expect("RPAREN");
      return val;
    }

    if (tok.kind === "IDENT") {
      this.consume();
      const name = tok.value.toUpperCase();

      // prop("colName") — special built-in
      if (name === "PROP") {
        this.expect("LPAREN");
        const colNameTok = this.expect("STR");
        this.expect("RPAREN");
        return this.resolveProp(colNameTok.value);
      }

      // Function call
      if (this.peek().kind === "LPAREN") {
        this.consume(); // '('
        const args: FormulaValue[] = [];
        if (this.peek().kind !== "RPAREN") {
          args.push(this.parseExpression());
          while (this.peek().kind === "COMMA") {
            this.consume();
            args.push(this.parseExpression());
          }
        }
        this.expect("RPAREN");
        return this.callFunction(name, args);
      }

      throw new Error(`Unknown identifier: ${tok.value}`);
    }

    throw new Error(`Unexpected token: ${tok.kind} (${tok.value})`);
  }

  // ── prop resolution ──────────────────────────────────────────────────────────

  private resolveProp(colName: string): FormulaValue {
    const col = this.columns.find(
      c => c.name.toLowerCase() === colName.toLowerCase() && c.type !== "formula",
    );
    if (!col) return "";
    const raw = this.row.cells[col.id] ?? "";
    if (col.type === "number") {
      const n = Number(raw);
      if (raw !== "" && !isNaN(n)) return n;
    }
    if (col.type === "checkbox") {
      return raw === "true";
    }
    return raw;
  }

  // ── built-in function registry ────────────────────────────────────────────────

  private callFunction(name: string, args: FormulaValue[]): FormulaValue {
    switch (name) {
      case "IF": {
        if (args.length < 2) throw new Error("IF requires at least 2 args");
        const cond = isTruthy(args[0]);
        return cond ? (args[1] ?? "") : (args[2] ?? "");
      }

      case "CONCAT": {
        return args.map(a => String(a)).join("");
      }

      case "ROUND": {
        const n = toNumber(args[0]);
        const digits = args.length >= 2 ? Math.max(0, Math.floor(toNumber(args[1]))) : 0;
        const factor = Math.pow(10, digits);
        return Math.round(n * factor) / factor;
      }

      case "ABS": {
        return Math.abs(toNumber(args[0]));
      }

      case "NOT": {
        return !isTruthy(args[0]);
      }

      default:
        throw new Error(`Unknown function: ${name}`);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNumber(v: FormulaValue | undefined): number {
  if (v === undefined || v === null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function isTruthy(v: FormulaValue | undefined): boolean {
  if (v === undefined || v === null || v === false || v === 0 || v === "") return false;
  return true;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function evalFormula(
  formula: string,
  row: { cells: Record<string, string> },
  columns: { id: string; name: string; type: string }[],
): string {
  if (!formula.trim()) return "";
  try {
    const tokens = tokenize(formula);
    const parser = new Parser(tokens, row, columns);
    const result = parser.parseExpression();
    // Ensure we've consumed the whole expression (ignoring EOF)
    return result === undefined || result === null ? "" : String(result);
  } catch {
    return "#ERROR";
  }
}
