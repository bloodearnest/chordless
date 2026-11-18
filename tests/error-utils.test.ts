import { expect } from '@open-wc/testing'
import { errorMessage, isForPeople, UserError, whatToSay } from '../src/js/utils/errors.ts'
import { transactionError } from '../src/js/utils/idb.ts'
import { showStatusMessage } from '../src/js/utils/status-message.ts'
import { TeamError } from '../src/js/worker-call.ts'

const { describe, it } = window

describe('errorMessage', () => {
  it('is the message of an Error, or the text of anything else thrown', () => {
    expect(errorMessage(new Error('Drive said no'))).to.equal('Drive said no')
    expect(errorMessage('plain string')).to.equal('plain string')
    expect(errorMessage(null)).to.equal('null')
  })
})

describe('transactionError', () => {
  const failure = (error: Error | null) => ({ error }) as IDBTransaction

  it('is the error of the request that failed', () => {
    const request = { error: new Error('ConstraintError') } as IDBRequest
    const event = { target: request } as unknown as Event
    expect(transactionError(event, failure(null))).to.equal(request.error)
  })

  it('is the transaction’s own error when the event has no request error', () => {
    const own = new Error('aborted')
    expect(transactionError({ target: null } as unknown as Event, failure(own))).to.equal(own)
    expect(
      transactionError({ target: { error: null } } as unknown as Event, failure(own))
    ).to.equal(own)
  })
})

describe('showStatusMessage', () => {
  it('replaces what is in the container with the message', () => {
    const container = document.createElement('div')
    container.textContent = 'old'
    const shown = showStatusMessage(container, { message: 'Nothing here', detail: 'Add one' })
    expect(container.children).to.have.length(1)
    expect(container.firstElementChild).to.equal(shown)
    expect(shown?.message).to.equal('Nothing here')
    expect(shown?.detail).to.equal('Add one')
    expect(shown?.state).to.equal('info')
  })

  it('leaves the message and detail alone when none are given', () => {
    const container = document.createElement('div')
    const shown = showStatusMessage(container, { state: 'loading' })
    expect(shown?.state).to.equal('loading')
    expect(shown?.message).to.not.be.ok
    expect(shown?.detail).to.not.be.ok
  })

  it('shows nothing, and says so, with no container', () => {
    expect(showStatusMessage(null, { message: 'x' })).to.equal(null)
  })
})

describe('what a person is told of an error', () => {
  const quiet = () => {
    const warn = console.warn
    console.warn = () => {}
    return () => {
      console.warn = warn
    }
  }

  it('is the error’s own words when they were written for the person', () => {
    expect(whatToSay(new UserError('Please provide a pad set name.'), 'Failed.')).to.equal(
      'Please provide a pad set name.'
    )
    expect(isForPeople(new UserError('x'))).to.equal(true)
  })

  it('is what failed, in words, for any other error, which is kept for the console', () => {
    const logged: unknown[][] = []
    const warn = console.warn
    console.warn = (...args: unknown[]) => void logged.push(args)
    try {
      const raw = new Error('Upload error: 403 Forbidden')
      expect(whatToSay(raw, "Couldn't save it.")).to.equal("Couldn't save it.")
      expect(logged).to.have.length(1)
      expect(logged[0][1]).to.equal(raw)
      expect(isForPeople(raw)).to.equal(false)
      expect(whatToSay('a string was thrown', "Couldn't save it.")).to.equal("Couldn't save it.")
    } finally {
      console.warn = warn
    }
  })

  it('is the Worker’s reason when it refused the request, and not when it failed itself', () => {
    const restore = quiet()
    try {
      expect(whatToSay(new TeamError('This invite is not valid', 404), 'Failed.')).to.equal(
        'This invite is not valid'
      )
      expect(whatToSay(new TeamError('Internal Server Error', 500), 'Failed.')).to.equal('Failed.')
    } finally {
      restore()
    }
  })
})
