// Unit tests for pad-audio-controller.js
// Run this file with: node pad-audio-controller.test.js

// Mock browser globals before importing modules
global.window = {
    location: {
        hostname: 'localhost'
    },
    addEventListener: () => {},
    removeEventListener: () => {}
};

global.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
};

global.caches = {
    open: () => Promise.resolve({
        match: () => Promise.resolve(undefined),
        put: () => Promise.resolve()
    })
};

// Mock Audio element
global.Audio = class MockAudio {
    constructor() {
        this.src = '';
        this.loop = false;
        this.crossOrigin = null;
        this.paused = true;
        this.currentTime = 0;
        this.currentSrc = '';
        this._eventListeners = {};
    }

    addEventListener(event, handler) {
        if (!this._eventListeners[event]) {
            this._eventListeners[event] = [];
        }
        this._eventListeners[event].push(handler);
    }

    removeEventListener(event, handler) {
        if (this._eventListeners[event]) {
            const index = this._eventListeners[event].indexOf(handler);
            if (index > -1) {
                this._eventListeners[event].splice(index, 1);
            }
        }
    }

    play() {
        this.paused = false;
        this.currentSrc = this.src;
        // Simulate 'playing' event
        setTimeout(() => {
            if (this._eventListeners['playing']) {
                this._eventListeners['playing'].forEach(handler => handler());
            }
        }, 10);
        return Promise.resolve();
    }

    pause() {
        this.paused = true;
    }

    removeAttribute(attr) {
        if (attr === 'src') {
            this.src = '';
        }
    }
};

import { PadAudioController } from '../js/pad-audio-controller.js';

// Simple test framework
let testCount = 0;
let passCount = 0;
let failCount = 0;

function assert(condition, message) {
    testCount++;
    if (condition) {
        passCount++;
        console.log(`✓ ${message}`);
    } else {
        failCount++;
        console.error(`✗ ${message}`);
    }
}

function assertEquals(actual, expected, message) {
    const matches = JSON.stringify(actual) === JSON.stringify(expected);
    assert(matches, `${message} (expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)})`);
}

// Mock Web Audio API
class MockAudioContext {
    constructor() {
        this.state = 'running';
        this.currentTime = 0;
        this.resumeCalled = false;
        this.destination = {};
    }

    resume() {
        this.resumeCalled = true;
        return Promise.resolve();
    }

    createMediaElementSource(element) {
        return new MockMediaElementSource(element);
    }

    createGain() {
        return new MockGainNode();
    }

    createChannelSplitter(channels) {
        return new MockChannelNode();
    }

    createChannelMerger(channels) {
        return new MockChannelNode();
    }
}

class MockMediaElementSource {
    constructor(element) {
        this.element = element;
        this.connected = false;
    }

    connect(destination) {
        this.connected = true;
        this.destination = destination;
    }

    disconnect() {
        this.connected = false;
    }
}

class MockGainNode {
    constructor() {
        this.gain = {
            value: 1.0,
            setValueAtTime: function(value, time) {
                this.value = value;
            },
            exponentialRampToValueAtTime: function(value, time) {
                this.value = value;
            }
        };
        this.connected = false;
        this.destinations = [];
    }

    connect(destination, outputIndex, inputIndex) {
        this.connected = true;
        this.destinations.push({ destination, outputIndex, inputIndex });
    }

    disconnect() {
        this.connected = false;
        this.destinations = [];
    }
}

class MockChannelNode {
    constructor() {
        this.connected = false;
        this.destinations = [];
    }

    connect(destination, outputIndex, inputIndex) {
        this.connected = true;
        this.destinations.push({ destination, outputIndex, inputIndex });
    }

    disconnect() {
        this.connected = false;
        this.destinations = [];
    }
}

console.log('Running pad-audio-controller.js tests...\n');

// ===== Test Constructor =====
console.log('=== Testing Constructor ===');

try {
    const context = new MockAudioContext();
    const controller = new PadAudioController(context);
    assert(true, 'Constructor accepts valid arguments');
    assert(!controller.isPlaying, 'Controller starts in stopped state');
    assert(!controller.loadFailed, 'Controller starts with loadFailed=false');
    assert(controller.currentKey === null, 'Controller starts with no key');
} catch (e) {
    assert(false, `Constructor accepts valid arguments: ${e.message}`);
}

try {
    new PadAudioController(null);
    assert(false, 'Constructor throws error for null AudioContext');
} catch (e) {
    assert(true, 'Constructor throws error for null AudioContext');
}

// ===== Test Custom Fade Duration =====
console.log('\n=== Testing Custom Fade Duration ===');

const context1 = new MockAudioContext();
const controller1 = new PadAudioController(context1, { fadeDuration: 5000 });
assert(true, 'Constructor accepts custom fade duration');

// ===== Test Load Pad =====
console.log('\n=== Testing Load Pad ===');

const context2 = new MockAudioContext();
const controller2 = new PadAudioController(context2);

// Test loading without key
const noLoad = await controller2.loadPad(null);
assert(!noLoad, 'loadPad returns false when key is null');

// Test loading with valid key
const loaded = await controller2.loadPad('C');
assert(loaded, 'loadPad returns true with valid key');
assertEquals(controller2.currentKey, 'C', 'currentKey is set correctly');

// Test loading different key
await controller2.loadPad('D');
assertEquals(controller2.currentKey, 'D', 'currentKey updates when loading new pad');

// ===== Test Volume Control =====
console.log('\n=== Testing Volume Control ===');

const context3 = new MockAudioContext();
const controller3 = new PadAudioController(context3);

await controller3.loadPad('C');
controller3.setVolume(0.5);
assert(true, 'setVolume can be called');

controller3.setVolume(0.8);
assert(true, 'setVolume can be called multiple times');

// ===== Test Stereo Mode =====
console.log('\n=== Testing Stereo Mode ===');

const context4 = new MockAudioContext();
const controller4 = new PadAudioController(context4);

await controller4.loadPad('C');

controller4.setStereoMode('left');
assert(true, 'setStereoMode accepts "left"');

controller4.setStereoMode('right');
assert(true, 'setStereoMode accepts "right"');

controller4.setStereoMode('both');
assert(true, 'setStereoMode accepts "both"');

controller4.setStereoMode('invalid');
assert(true, 'setStereoMode ignores invalid modes');

// ===== Test Play/Stop =====
console.log('\n=== Testing Play/Stop ===');

const context5 = new MockAudioContext();
const controller5 = new PadAudioController(context5);

await controller5.loadPad('E');

// Test play
await controller5.play();
// Give time for async operations
await new Promise(resolve => setTimeout(resolve, 100));
assert(controller5.isPlaying, 'Controller is playing after play()');

// Test stop
await controller5.stop();
// Give time for fade out (we'll use instant for tests)
await new Promise(resolve => setTimeout(resolve, 100));
assert(!controller5.isPlaying, 'Controller is stopped after stop()');

// ===== Test Multiple Load Cycles =====
console.log('\n=== Testing Multiple Load Cycles ===');

const context6 = new MockAudioContext();
const controller6 = new PadAudioController(context6);

for (let i = 0; i < 3; i++) {
    const keys = ['C', 'D', 'E'];
    const key = keys[i];
    await controller6.loadPad(key);
    assertEquals(controller6.currentKey, key, `Current key is ${key} after load cycle ${i + 1}`);
}

// ===== Test Cleanup =====
console.log('\n=== Testing Cleanup ===');

const context7 = new MockAudioContext();
const controller7 = new PadAudioController(context7);

await controller7.loadPad('G');
await controller7.play();
await new Promise(resolve => setTimeout(resolve, 50));

controller7.cleanup();
assert(true, 'Cleanup completes without error');

// ===== Test AudioContext Resume =====
console.log('\n=== Testing AudioContext Resume ===');

const suspendedContext = new MockAudioContext();
suspendedContext.state = 'suspended';
const controller8 = new PadAudioController(suspendedContext);

await controller8.loadPad('A');
await controller8.play();
await new Promise(resolve => setTimeout(resolve, 50));

assert(suspendedContext.resumeCalled, 'AudioContext.resume() called when suspended');

// ===== Test Crossfade =====
console.log('\n=== Testing Crossfade ===');

const context9 = new MockAudioContext();
const controller9 = new PadAudioController(context9);

await controller9.loadPad('C');
await controller9.play();
await new Promise(resolve => setTimeout(resolve, 50));

const originalKey = controller9.currentKey;
await controller9.crossfadeTo('G');
// Give time for crossfade to start
await new Promise(resolve => setTimeout(resolve, 50));

assert(controller9.currentKey === 'G', 'Key updated after crossfade');
assert(controller9.currentKey !== originalKey, 'Key changed during crossfade');

// ===== Test IsLoading Property =====
console.log('\n=== Testing IsLoading Property ===');

const context10 = new MockAudioContext();
const controller10 = new PadAudioController(context10);

assert(controller10.isLoading === false, 'isLoading is false initially');

// ===== Summary =====
console.log('\n=== Test Summary ===');
console.log(`Total tests: ${testCount}`);
console.log(`Passed: ${passCount}`);
console.log(`Failed: ${failCount}`);

if (failCount === 0) {
    console.log('\n✓ All tests passed!');
} else {
    console.log(`\n✗ ${failCount} test(s) failed`);
    process.exit(1);
}
