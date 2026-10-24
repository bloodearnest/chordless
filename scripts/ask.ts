import { createInterface } from 'node:readline/promises'

// A question put to the person at the terminal (shared by the scripts that set up credentials)

/** One line from the terminal; with `hidden`, nothing is shown while it is typed */
export async function ask(question: string, { hidden = false } = {}): Promise<string> {
  if (!hidden) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = await rl.question(question)
    rl.close()
    return answer.trim()
  }
  process.stdout.write(question)
  return new Promise(resolve => {
    let typed = ''
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\u0003') process.exit(130)
        if (char === '\r' || char === '\n') {
          process.stdin.setRawMode(false)
          process.stdin.pause()
          process.stdin.off('data', onData)
          process.stdout.write('\n')
          resolve(typed.trim())
          return
        }
        typed = char === '\u007f' ? typed.slice(0, -1) : typed + char
      }
    }
    process.stdin.on('data', onData)
  })
}
