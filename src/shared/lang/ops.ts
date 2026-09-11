/**
 * The RPN operator table: what each word does to the stack.
 *
 * Data, not code — a new operator is a new row, and the corpus sweep
 * (`npm run lang:sweep`) reports every word it meets that is not here, which
 * is how the table grows toward complete instead of being guessed complete.
 *
 * Sources: the SDK's Reverse Polish Notation page, Asobo's templates, and
 * the corpus. Registers (`s0`–`s49`, `l0`–`l49`, `sp0`–`sp49`) are matched
 * by pattern below rather than listed fifty times.
 */

export interface StackEffect {
  pops: number
  pushes: number
}

const BINARY: StackEffect = { pops: 2, pushes: 1 }
const UNARY: StackEffect = { pops: 1, pushes: 1 }

const OPS: Record<string, StackEffect> = {
  // Arithmetic
  "+": BINARY,
  "-": BINARY,
  "*": BINARY,
  "/": BINARY,
  "%": BINARY,
  div: BINARY,
  pow: BINARY,
  min: BINARY,
  max: BINARY,
  neg: UNARY,
  abs: UNARY,
  int: UNARY,
  flr: UNARY,
  ceil: UNARY,
  sqr: UNARY,
  sqrt: UNARY,
  ln: UNARY,
  log: BINARY,
  exp: UNARY,
  "near": UNARY,
  // Trigonometry
  sin: UNARY,
  cos: UNARY,
  tan: UNARY,
  asin: UNARY,
  acos: UNARY,
  atan: UNARY,
  atg2: BINARY,
  rddg: UNARY,
  dgrd: UNARY,
  rnor: UNARY,
  dnor: UNARY,
  pi: { pops: 0, pushes: 1 },
  // Comparison
  "==": BINARY,
  "!=": BINARY,
  "<": BINARY,
  ">": BINARY,
  "<=": BINARY,
  ">=": BINARY,
  // Logic
  and: BINARY,
  "&&": BINARY,
  or: BINARY,
  "||": BINARY,
  "!": UNARY,
  not: UNARY,
  // Bitwise
  "&": BINARY,
  "|": BINARY,
  "^": BINARY,
  ">>": BINARY,
  "<<": BINARY,
  // Stack shuffling
  d: { pops: 1, pushes: 2 },
  p: { pops: 1, pushes: 0 },
  r: { pops: 2, pushes: 2 },
  swap: { pops: 2, pushes: 2 },
  /*
   * Flow. `if{` consumes the condition; the words between it and `}` are a
   * body the linear simulator walks straight through — see stack.ts on why
   * branch reconciliation is deliberately not attempted yet.
   */
  "if{": { pops: 1, pushes: 0 },
  "els{": { pops: 0, pushes: 0 },
  "}": { pops: 0, pushes: 0 },
  quit: { pops: 0, pushes: 0 },
  // Strings
  lc: UNARY,
  uc: UNARY,
  cap: UNARY,
  chr: UNARY,
  ord: UNARY,
  slen: UNARY,
  symb: BINARY,
  scat: BINARY,
  schr: BINARY,
  scmp: BINARY,
  scmi: BINARY,
  sstr: BINARY,
  ssub: { pops: 3, pushes: 1 },
}

/** `s0`–`s49` store-keep, `sp0`–`sp49` store-pop, `l0`–`l49` load. */
const REGISTER = /^(s|sp|l)([0-9]|[1-4][0-9])$/

/**
 * The stack effect of one word, or null for a word this table does not know.
 *
 * Null is an answer, not an error: the stack simulator goes conservative
 * from an unknown word onward, and the sweep reports the word so the table
 * can learn it. Case-insensitive because the sim's parser is.
 */
export function stackEffectOf(word: string): StackEffect | null {
  const lower = word.toLowerCase()

  const register = REGISTER.exec(lower)
  if (register) {
    if (register[1] === "s") return { pops: 1, pushes: 1 }
    if (register[1] === "sp") return { pops: 1, pushes: 0 }
    return { pops: 0, pushes: 1 }
  }

  return OPS[lower] ?? null
}
