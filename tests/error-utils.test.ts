import { expect } from '@open-wc/testing'
import { errorMessage } from '../src/js/utils/errors.ts'
import { transactionError } from '../src/js/utils/idb.ts'
import { showStatusMessage } from '../src/js/utils/status-message.ts'

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
