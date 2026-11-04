/**
 * Ten deterministic coding-task fixtures with hidden correctness checks.
 *
 * Each fixture declares an initial workspace, a prompt, a scripted trajectory
 * (tool calls and final text) for the deterministic backend, and a check that
 * verifies the workspace state after the agent finishes.
 *
 * The fixtures exercise the inherited OpenCode tool surface: write, edit, and
 * shell tools across simple arithmetic, text manipulation, and code-generation
 * tasks.
 */
import { Effect } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import type { Fixture } from "../types.js"

/** Reads a file from the fixture workspace, returning "" on error. */
const readFile = (directory: string, rel: string) =>
  Effect.tryPromise(() => fs.readFile(path.join(directory, rel), "utf-8")).pipe(
    Effect.match({
      onFailure: () => "",
      onSuccess: (content) => content,
    }),
  )

/** Checks that a file equals an expected string exactly. */
const checkEquals = (directory: string, rel: string, expected: string) =>
  Effect.gen(function* () {
    const content = yield* readFile(directory, rel)
    const pass = content.trim() === expected
    return {
      pass,
      details: pass ? `${rel} equals "${expected}"` : `${rel} is "${content.trim()}", expected "${expected}"`
    }
  })

/** Writes a value using the write tool. */
const write = (rel: string, content: string) => ({
  toolCalls: [{ name: "write", input: { path: rel, content } }]
})

/** Returns a final text turn. */
const done = (text = "Done") => ({ text })

/** The complete fixture set. */
export const fixtures: readonly Fixture[] = [
  {
    id: "add",
    title: "Add two numbers",
    description: "Add 3 and 4 and write the result to answer.txt",
    files: {},
    prompt: "Add 3 and 4. Write the result to answer.txt.",
    script: [write("answer.txt", "7"), done()],
    check: (ctx) => checkEquals(ctx.directory, "answer.txt", "7"),
  },
  {
    id: "multiply",
    title: "Multiply two numbers",
    description: "Multiply 6 and 7 and write the result to answer.txt",
    files: {},
    prompt: "Multiply 6 and 7. Write the result to answer.txt.",
    script: [write("answer.txt", "42"), done()],
    check: (ctx) => checkEquals(ctx.directory, "answer.txt", "42"),
  },
  {
    id: "edit",
    title: "Write then edit a file",
    description: "Create greeting.txt with 'Hello World', then edit it to 'Hello ORBIT'",
    files: {},
    prompt: "Create greeting.txt with 'Hello World'. Then edit it to say 'Hello ORBIT'.",
    script: [
      write("greeting.txt", "Hello World"),
      { toolCalls: [{ name: "edit", input: { path: "greeting.txt", oldString: "Hello World", newString: "Hello ORBIT" } }] },
      done(),
    ],
    check: (ctx) =>
      Effect.gen(function* () {
        const content = yield* readFile(ctx.directory, "greeting.txt")
        const pass = content.includes("Hello ORBIT") && !content.includes("Hello World")
        return {
          pass,
          details: pass ? "greeting.txt was edited correctly" : `greeting.txt is "${content.trim()}"`
        }
      }),
  },
  {
    id: "shell",
    title: "Run a shell command",
    description: "Run echo 42 > answer.txt via the shell tool",
    files: {},
    prompt: "Use the shell to run 'echo 42 > answer.txt'.",
    script: [
      { toolCalls: [{ name: "shell", input: { command: "echo 42 > answer.txt" } }] },
      done(),
    ],
    check: (ctx) => checkEquals(ctx.directory, "answer.txt", "42"),
  },
  {
    id: "fizzbuzz",
    title: "Write a FizzBuzz function",
    description: "Write a FizzBuzz function to fizzbuzz.js",
    files: {},
    prompt: "Write a FizzBuzz function to fizzbuzz.js that returns 'Fizz' for multiples of 3, 'Buzz' for multiples of 5, and 'FizzBuzz' for multiples of both.",
    script: [
      write(
        "fizzbuzz.js",
        "function fizzbuzz(n) {\n  if (n % 15 === 0) return 'FizzBuzz';\n  if (n % 3 === 0) return 'Fizz';\n  if (n % 5 === 0) return 'Buzz';\n  return n;\n}\n",
      ),
      done(),
    ],
    check: (ctx) =>
      Effect.gen(function* () {
        const content = yield* readFile(ctx.directory, "fizzbuzz.js")
        const hasFizz = content.includes("Fizz")
        const hasBuzz = content.includes("Buzz")
        const hasFizzBuzz = content.includes("FizzBuzz")
        const pass = hasFizz && hasBuzz && hasFizzBuzz
        return {
          pass,
          details: pass ? "fizzbuzz.js contains Fizz, Buzz, and FizzBuzz" : "fizzbuzz.js is missing expected strings"
        }
      }),
  },
  {
    id: "palindrome",
    title: "Identify a palindrome",
    description: "Write 'racecar' to palindrome.txt",
    files: {},
    prompt: "The word 'racecar' is a palindrome. Write it to palindrome.txt.",
    script: [write("palindrome.txt", "racecar"), done()],
    check: (ctx) => checkEquals(ctx.directory, "palindrome.txt", "racecar"),
  },
  {
    id: "reverse",
    title: "Reverse a string",
    description: "Reverse 'hello' to 'olleh' and write to reverse.txt",
    files: {},
    prompt: "Reverse the string 'hello' and write the result to reverse.txt.",
    script: [write("reverse.txt", "olleh"), done()],
    check: (ctx) => checkEquals(ctx.directory, "reverse.txt", "olleh"),
  },
  {
    id: "factorial",
    title: "Calculate factorial",
    description: "Calculate 5! = 120 and write to factorial.txt",
    files: {},
    prompt: "Calculate 5 factorial (5!) and write the result to factorial.txt.",
    script: [write("factorial.txt", "120"), done()],
    check: (ctx) => checkEquals(ctx.directory, "factorial.txt", "120"),
  },
  {
    id: "count",
    title: "Count substring occurrences",
    description: "Count 'a' in 'banana' (3) and write to count.txt",
    files: {},
    prompt: "Count how many times the letter 'a' appears in 'banana'. Write the count to count.txt.",
    script: [write("count.txt", "3"), done()],
    check: (ctx) => checkEquals(ctx.directory, "count.txt", "3"),
  },
  {
    id: "gcd",
    title: "Calculate greatest common divisor",
    description: "Calculate GCD of 12 and 18 (6) and write to gcd.txt",
    files: {},
    prompt: "Calculate the greatest common divisor of 12 and 18. Write the result to gcd.txt.",
    script: [write("gcd.txt", "6"), done()],
    check: (ctx) => checkEquals(ctx.directory, "gcd.txt", "6"),
  },
]
