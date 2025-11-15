// Unit tests for HTML templates
// Run this file by opening template-test.html in a browser

// Simple test framework
let testCount = 0;
let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  testCount++;
  if (condition) {
    passCount++;
    console.log(`✓ ${message}`);
    addTestResult(true, message);
  } else {
    failCount++;
    console.error(`✗ ${message}`);
    addTestResult(false, message);
  }
}

function assertEquals(actual, expected, message) {
  const matches = actual === expected;
  assert(matches, `${message} (expected: ${expected}, got: ${actual})`);
}

function addTestResult(passed, message) {
  const resultDiv = document.createElement('div');
  resultDiv.className = passed ? 'test-pass' : 'test-fail';
  resultDiv.textContent = (passed ? '✓ ' : '✗ ') + message;
  document.getElementById('test-results').appendChild(resultDiv);
}

async function loadHTMLContent(url) {
  const response = await fetch(url);
  const html = await response.text();
  const parser = new DOMParser();
  return parser.parseFromString(html, 'text/html');
}

async function runTests() {
  console.log('Running template tests...\n');

  // ===== Test index.html templates =====
  console.log('=== Testing index.html ===');

  const indexDoc = await loadHTMLContent('/index.html');

  // Test setlist item template exists
  const setlistItemTemplate = indexDoc.getElementById('setlist-item-template');
  assert(setlistItemTemplate !== null, 'setlist-item-template exists');
  assert(
    setlistItemTemplate.tagName === 'TEMPLATE',
    'setlist-item-template is a <template> element'
  );

  // Test template content
  if (setlistItemTemplate) {
    const content = setlistItemTemplate.content;
    assert(content !== null, 'Template has content property');

    // Test structure
    const setlistItem = content.querySelector('.setlist-item');
    assert(setlistItem !== null, 'Template contains .setlist-item');

    const dateElement = content.querySelector('.setlist-date');
    assert(dateElement !== null, 'Template contains .setlist-date');

    const nameElement = content.querySelector('.setlist-name');
    assert(nameElement !== null, 'Template contains .setlist-name');

    const songCountElement = content.querySelector('.setlist-song-count');
    assert(songCountElement !== null, 'Template contains .setlist-song-count');

    // Test cloning
    const clone = content.cloneNode(true);
    assert(clone !== null, 'Template can be cloned');

    const clonedItem = clone.querySelector('.setlist-item');
    assert(clonedItem !== null, 'Cloned content contains .setlist-item');

    // Test populating cloned content
    const clonedDate = clone.querySelector('.setlist-date');
    clonedDate.textContent = '2025-10-17';
    assertEquals(clonedDate.textContent, '2025-10-17', 'Can set date text content');

    const clonedName = clone.querySelector('.setlist-name');
    clonedName.textContent = 'Morning Service';
    assertEquals(clonedName.textContent, 'Morning Service', 'Can set name text content');

    const clonedCount = clone.querySelector('.setlist-song-count');
    clonedCount.textContent = '5 songs';
    assertEquals(clonedCount.textContent, '5 songs', 'Can set song count text content');
  }

  // ===== Test setlist.html templates =====
  console.log('\n=== Testing setlist.html ===');

  const setlistDoc = await loadHTMLContent('/setlist.html');

  // Test key option template exists
  const keyOptionTemplate = setlistDoc.getElementById('key-option-template');
  assert(keyOptionTemplate !== null, 'key-option-template exists');
  assert(keyOptionTemplate.tagName === 'TEMPLATE', 'key-option-template is a <template> element');

  // Test template content
  if (keyOptionTemplate) {
    const content = keyOptionTemplate.content;
    assert(content !== null, 'Template has content property');

    // Test structure
    const keyOption = content.querySelector('.key-option-item');
    assert(keyOption !== null, 'Template contains .key-option-item');
    assert(keyOption.tagName === 'BUTTON', 'key-option-item is a button');

    const keyName = content.querySelector('.key-name');
    assert(keyName !== null, 'Template contains .key-name');

    const keyOffset = content.querySelector('.key-offset');
    assert(keyOffset !== null, 'Template contains .key-offset');

    // Test cloning
    const clone = content.cloneNode(true);
    assert(clone !== null, 'Template can be cloned');

    const clonedOption = clone.querySelector('.key-option-item');
    assert(clonedOption !== null, 'Cloned content contains .key-option-item');

    // Test populating cloned content
    const clonedName = clone.querySelector('.key-name');
    clonedName.textContent = 'G*';
    assertEquals(clonedName.textContent, 'G*', 'Can set key name text content');

    const clonedOffset = clone.querySelector('.key-offset');
    clonedOffset.textContent = '+2';
    assertEquals(clonedOffset.textContent, '+2', 'Can set key offset text content');

    // Test that cloning doesn't affect original
    const originalName = content.querySelector('.key-name');
    assert(originalName.textContent === '', 'Original template unchanged after cloning');
  }

  // Test required HTML elements exist in setlist.html
  const mainContent = setlistDoc.getElementById('main-content');
  assert(mainContent !== null, 'main-content element exists');

  const songTitleHeader = setlistDoc.getElementById('song-title-header');
  assert(songTitleHeader !== null, 'song-title-header element exists');

  const keyValueDisplay = setlistDoc.getElementById('key-value-display');
  assert(keyValueDisplay !== null, 'key-value-display element exists');

  const keySelectorButton = setlistDoc.getElementById('key-selector-button');
  assert(keySelectorButton !== null, 'key-selector-button element exists');

  const keyOptionsList = setlistDoc.getElementById('key-options-list');
  assert(keyOptionsList !== null, 'key-options-list element exists');

  // ===== Test index.html structure =====
  console.log('\n=== Testing index.html structure ===');

  const homeView = indexDoc.getElementById('home-view');
  assert(homeView !== null, 'home-view element exists');

  const setlistList = indexDoc.getElementById('setlist-list');
  assert(setlistList !== null, 'setlist-list element exists');

  // ===== Summary =====
  console.log('\n=== Test Summary ===');
  console.log(`Total tests: ${testCount}`);
  console.log(`Passed: ${passCount}`);
  console.log(`Failed: ${failCount}`);

  const summaryDiv = document.getElementById('test-summary');
  if (failCount === 0) {
    console.log('\n✓ All tests passed!');
    summaryDiv.textContent = `✓ All ${testCount} tests passed!`;
    summaryDiv.className = 'summary-pass';
  } else {
    console.error(`\n✗ ${failCount} test(s) failed`);
    summaryDiv.textContent = `✗ ${failCount} of ${testCount} tests failed`;
    summaryDiv.className = 'summary-fail';
  }
}

// Run tests when page loads
window.addEventListener('DOMContentLoaded', runTests);
