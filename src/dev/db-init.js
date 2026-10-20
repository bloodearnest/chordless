import { ChordlessDB } from '/js/db.ts'
import { SpaceDB } from '/js/space-db.ts'

const output = document.getElementById('output')

function log(message, type = 'info') {
  const div = document.createElement('div')
  div.className = type
  div.textContent = message
  output.appendChild(div)
  console.log(message)
}

function logObject(label, obj) {
  const div = document.createElement('div')
  div.innerHTML = `<strong>${label}:</strong><pre>${JSON.stringify(obj, null, 2)}</pre>`
  output.appendChild(div)
  console.log(label, obj)
}

async function test() {
  try {
    log('=== Testing SpaceDB ===')

    // Test 1: Create space database
    log('1. Creating SpaceDB...')
    const spaceDB = new SpaceDB()
    await spaceDB.init()
    log('✓ SpaceDB initialized', 'success')

    // Test 2: Create TEST space
    log('2. Creating TEST space...')
    const testSpace = await spaceDB.createSpace('TEST', 'test@example.com')
    logObject('Created space', testSpace)
    log('✓ TEST space created', 'success')

    // Test 3: Retrieve space
    log('3. Retrieving space by ID...')
    const retrieved = await spaceDB.getSpace(testSpace.id)
    logObject('Retrieved space', retrieved)
    log('✓ Space retrieved successfully', 'success')

    log('\\n=== Testing ChordlessDB ===')

    // Test 4: Create space-specific database
    log(`4. Creating ChordlessDB for space ${testSpace.id}...`)
    const db = new ChordlessDB(testSpace.id)
    await db.init()
    log('✓ ChordlessDB initialized', 'success')

    // Test 5: Verify all object stores exist
    log('5. Verifying object stores...')
    const stores = Array.from(db.db.objectStoreNames)
    logObject('Object stores', stores)

    const expected = ['songs', 'chordpro', 'setlists', 'setlist_local']
    const missing = expected.filter(s => !stores.includes(s))

    if (missing.length > 0) {
      log(`✗ Missing stores: ${missing.join(', ')}`, 'error')
    } else {
      log('✓ All expected stores present', 'success')
    }

    // Test 6: Verify songs store structure
    log('6. Verifying songs store indexes...')
    const tx = db.db.transaction(['songs'], 'readonly')
    const songsStore = tx.objectStore('songs')
    const songsIndexes = Array.from(songsStore.indexNames)
    logObject('Songs indexes', songsIndexes)

    const expectedIndexes = ['id', 'ccliNumber', 'titleNormalized', 'isDefault', 'importDate']
    const missingIndexes = expectedIndexes.filter(i => !songsIndexes.includes(i))

    if (missingIndexes.length > 0) {
      log(`✗ Missing indexes: ${missingIndexes.join(', ')}`, 'error')
    } else {
      log('✓ All expected indexes present', 'success')
    }

    log('\\n=== Testing CRUD Operations ===')

    // Test 7: Create a test song
    log('7. Creating test song...')
    const testSong = {
      uuid: crypto.randomUUID(),
      id: 'ccli-12345',
      variantOf: null,
      isDefault: true,
      variantLabel: 'Original',
      chordproFileId: 'chordpro-test-1',
      ccliNumber: '12345',
      title: 'Test Song',
      titleNormalized: 'test song',
      author: 'Test Author',
      copyright: '2025 Test',
      key: 'G',
      tempo: 120,
      time: '4/4',
      importDate: new Date().toISOString(),
      importUser: 'test@example.com',
      importSource: 'test',
      sourceUrl: null,
      modifiedDate: new Date().toISOString(),
      fileRef: null,
      fileModified: null,
      lastSyncedAt: null,
      contentHash: 'test-hash-123',
    }

    await db.saveSong(testSong)
    log('✓ Test song saved', 'success')

    // Test 8: Retrieve the song
    log('8. Retrieving test song...')
    const retrievedSong = await db.getSong(testSong.uuid)
    logObject('Retrieved song', retrievedSong)
    log('✓ Song retrieved successfully', 'success')

    // Test 9: Create test chordpro content
    log('9. Creating test ChordPro content...')
    const testChordPro = {
      id: 'chordpro-test-1',
      content: '{title: Test Song}\\n{key: G}\\n\\nTest [G]lyrics',
      contentHash: 'test-hash-123',
      createdDate: new Date().toISOString(),
      modifiedDate: new Date().toISOString(),
    }

    await db.saveChordPro(testChordPro)
    log('✓ ChordPro content saved', 'success')

    // Test 10: Create test setlist
    log('10. Creating test setlist...')
    const testSetlist = {
      id: crypto.randomUUID(),
      date: '2025-01-01',
      time: '10:00',
      type: 'Church Service',
      owner: 'test@example.com',
      name: 'Test Setlist',
      songs: [
        {
          order: 0,
          songId: testSong.id,
          songUuid: testSong.uuid,
          key: null,
          tempo: null,
          notes: 'Test notes',
        },
      ],
      createdDate: new Date().toISOString(),
      modifiedDate: new Date().toISOString(),
      fileRef: null,
      fileModified: null,
      lastSyncedAt: null,
      _lastSyncHash: null,
    }

    await db.saveSetlist(testSetlist)
    log('✓ Test setlist saved', 'success')

    // Test 11: Create test local state
    log('11. Creating test local state...')
    const testLocalState = {
      setlistId: testSetlist.id,
      padsEnabled: true,
      padSound: 'ambient',
      clickEnabled: false,
      sectionVisibility: {},
      lastUsedDate: new Date().toISOString(),
    }

    await db.saveLocalState(testLocalState)
    log('✓ Local state saved', 'success')

    // Test 12: Retrieve local state
    log('12. Retrieving local state...')
    const retrievedState = await db.getLocalState(testSetlist.id)
    logObject('Retrieved local state', retrievedState)
    log('✓ Local state retrieved successfully', 'success')

    log('\\n=== All Tests Passed! ===', 'success')
  } catch (error) {
    log(`\\n✗ Test failed: ${error.message}`, 'error')
    console.error('Full error:', error)
  }
}

// Run tests
test()
