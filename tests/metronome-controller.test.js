// Unit tests for metronome-controller.js
// Run this file with: node metronome-controller.test.js

import { MetronomeController } from '../js/metronome-controller.js';

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
    }

    resume() {
        this.resumeCalled = true;
        return Promise.resolve();
    }

    createOscillator() {
        return new MockOscillator(this);
    }

    createGain() {
        return new MockGainNode();
    }
}

class MockOscillator {
    constructor(context) {
        this.context = context;
        this.frequency = { value: 440 };
        this.connected = false;
        this.started = false;
        this.stopped = false;
    }

    connect(destination) {
        this.connected = true;
        this.destination = destination;
    }

    disconnect() {
        this.connected = false;
    }

    start(when) {
        this.started = true;
        this.startTime = when;
    }

    stop(when) {
        this.stopped = true;
        this.stopTime = when;
    }
}

class MockGainNode {
    constructor() {
        this.gain = {
            value: 1.0,
            setValueAtTime: function(value, _time) {
                this.value = value;
            },
            exponentialRampToValueAtTime: function(value, _time) {
                this.value = value;
            }
        };
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

console.log('Running metronome-controller.js tests...\n');

// ===== Test Constructor =====
console.log('=== Testing Constructor ===');

try {
    const context = new MockAudioContext();
    const gain = new MockGainNode();
    const controller = new MetronomeController(context, gain);
    assert(true, 'Constructor accepts valid arguments');
    assert(!controller.isRunning, 'Controller starts in stopped state');
} catch (e) {
    assert(false, `Constructor accepts valid arguments: ${e.message}`);
}

try {
    new MetronomeController(null, new MockGainNode());
    assert(false, 'Constructor throws error for null AudioContext');
} catch {
    assert(true, 'Constructor throws error for null AudioContext');
}

try {
    new MetronomeController(new MockAudioContext(), null);
    assert(false, 'Constructor throws error for null GainNode');
} catch {
    assert(true, 'Constructor throws error for null GainNode');
}

// ===== Test Start/Stop =====
console.log('\n=== Testing Start/Stop ===');

const context = new MockAudioContext();
const gain = new MockGainNode();
const controller = new MetronomeController(context, gain);

// Test start with valid parameters
const started = controller.start(120, '4/4', '1/4');
assert(started, 'Start returns true for valid parameters');
assert(controller.isRunning, 'Controller is running after start');

// Test stop
controller.stop();
assert(!controller.isRunning, 'Controller is stopped after stop');

// Test start without BPM
const noStart = controller.start(null, '4/4', '1/4');
assert(!noStart, 'Start returns false without BPM');
assert(!controller.isRunning, 'Controller not running after failed start');

// Test start without time signature
const noStart2 = controller.start(120, null, '1/4');
assert(!noStart2, 'Start returns false without time signature');

// ===== Test Volume Control =====
console.log('\n=== Testing Volume Control ===');

const context2 = new MockAudioContext();
const gain2 = new MockGainNode();
const controller2 = new MetronomeController(context2, gain2);

controller2.setVolume(0.5);
assertEquals(gain2.gain.value, 0.5, 'setVolume updates gain value');

controller2.setVolume(0.8);
assertEquals(gain2.gain.value, 0.8, 'setVolume can be called multiple times');

// ===== Test Time Signatures =====
console.log('\n=== Testing Time Signatures ===');

const context3 = new MockAudioContext();
const gain3 = new MockGainNode();
const controller3 = new MetronomeController(context3, gain3);

// Test 4/4
controller3.start(120, '4/4', '1/4');
assert(controller3.isRunning, 'Metronome starts in 4/4');
controller3.stop();

// Test 3/4
controller3.start(120, '3/4', '1/4');
assert(controller3.isRunning, 'Metronome starts in 3/4');
controller3.stop();

// Test 6/8 (compound time)
controller3.start(120, '6/8', '1/4');
assert(controller3.isRunning, 'Metronome starts in 6/8 (compound time)');
controller3.stop();

// Test 12/8 (compound time)
controller3.start(120, '12/8', '1/4');
assert(controller3.isRunning, 'Metronome starts in 12/8 (compound time)');
controller3.stop();

// Test 7/8 (odd time)
controller3.start(120, '7/8', '1/4');
assert(controller3.isRunning, 'Metronome starts in 7/8 (odd time)');
controller3.stop();

// ===== Test Tempo Notes =====
console.log('\n=== Testing Tempo Notes ===');

const context4 = new MockAudioContext();
const gain4 = new MockGainNode();
const controller4 = new MetronomeController(context4, gain4);

// Test quarter note tempo
controller4.start(120, '4/4', '1/4');
assert(controller4.isRunning, 'Metronome starts with quarter note tempo');
controller4.stop();

// Test eighth note tempo
controller4.start(120, '4/4', '1/8');
assert(controller4.isRunning, 'Metronome starts with eighth note tempo');
controller4.stop();

// Test half note tempo
controller4.start(60, '4/4', '1/2');
assert(controller4.isRunning, 'Metronome starts with half note tempo');
controller4.stop();

// Test with undefined tempo note (should default to 1/4)
controller4.start(120, '4/4', undefined);
assert(controller4.isRunning, 'Metronome starts with undefined tempo note (defaults to 1/4)');
controller4.stop();

// ===== Test BPM Calculations (_calculateQuarterNoteBpm) =====
console.log('\n=== Testing BPM Calculations ===');

const bpmContext = new MockAudioContext();
const bpmGain = new MockGainNode();
const bpmController = new MetronomeController(bpmContext, bpmGain);

// Test 1: Simple 4/4 at 120 BPM with 1/4 tempo
// Quarter note BPM = 120, clicking on 1/4 notes
// Expected: 60000 / 120 = 500ms
bpmController.start(120, '4/4', '1/4');
const interval1 = bpmController.beatInterval;
const expected1 = 500;
assert(Math.abs(interval1 - expected1) < 0.1, `4/4 at 120 BPM (1/4): ${interval1}ms (expected ${expected1}ms)`);
bpmController.stop();

// Test 2: 4/4 at 120 BPM with 1/8 tempo
// Quarter note BPM = 120 * (1 * 4 / 8) = 60
// Clicking on 1/4 notes, interval = 60000 / 60 = 1000ms
bpmController.start(120, '4/4', '1/8');
const interval2 = bpmController.beatInterval;
const expected2 = 1000;
assert(Math.abs(interval2 - expected2) < 0.1, `4/4 at 120 BPM (1/8): ${interval2}ms (expected ${expected2}ms)`);
bpmController.stop();

// Test 3: 4/4 at 60 BPM with 1/2 tempo
// Quarter note BPM = 60 * (1 * 4 / 2) = 120
// Clicking on 1/4 notes, interval = 60000 / 120 = 500ms
bpmController.start(60, '4/4', '1/2');
const interval3 = bpmController.beatInterval;
const expected3 = 500;
assert(Math.abs(interval3 - expected3) < 0.1, `4/4 at 60 BPM (1/2): ${interval3}ms (expected ${expected3}ms)`);
bpmController.stop();

// Test 4: 6/8 at 60 BPM with 1/4 tempo (compound time)
// Quarter note BPM = 60 * 1.5 = 90 (compound time conversion)
// Clicking on 1/8 notes, interval = 60000 / 90 / 2 = 333.33ms
bpmController.start(60, '6/8', '1/4');
const interval4 = bpmController.beatInterval;
const expected4 = 333.33;
assert(Math.abs(interval4 - expected4) < 0.1, `6/8 at 60 BPM (1/4, compound): ${interval4}ms (expected ${expected4}ms)`);
bpmController.stop();

// Test 5: 12/8 at 120 BPM with 1/4 tempo (compound time)
// Quarter note BPM = 120 * 1.5 = 180
// Clicking on 1/8 notes, interval = 60000 / 180 / 2 = 166.67ms
bpmController.start(120, '12/8', '1/4');
const interval5 = bpmController.beatInterval;
const expected5 = 166.67;
assert(Math.abs(interval5 - expected5) < 0.1, `12/8 at 120 BPM (1/4, compound): ${interval5}ms (expected ${expected5}ms)`);
bpmController.stop();

// Test 6: 3/4 at 90 BPM with 1/4 tempo
// Quarter note BPM = 90, clicking on 1/4 notes
// Expected: 60000 / 90 = 666.67ms
bpmController.start(90, '3/4', '1/4');
const interval6 = bpmController.beatInterval;
const expected6 = 666.67;
assert(Math.abs(interval6 - expected6) < 0.1, `3/4 at 90 BPM (1/4): ${interval6}ms (expected ${expected6}ms)`);
bpmController.stop();

// Test 7: 7/8 at 140 BPM with 1/4 tempo (odd time)
// Quarter note BPM = 140, clicking on 1/8 notes
// Interval = 60000 / 140 / 2 = 214.29ms
bpmController.start(140, '7/8', '1/4');
const interval7 = bpmController.beatInterval;
const expected7 = 214.29;
assert(Math.abs(interval7 - expected7) < 0.1, `7/8 at 140 BPM (1/4): ${interval7}ms (expected ${expected7}ms)`);
bpmController.stop();

// Test 8: 4/4 at 180 BPM with 1/8 tempo (fast tempo)
// Quarter note BPM = 180 * 0.5 = 90
// Clicking on 1/4 notes, interval = 60000 / 90 = 666.67ms
bpmController.start(180, '4/4', '1/8');
const interval8 = bpmController.beatInterval;
const expected8 = 666.67;
assert(Math.abs(interval8 - expected8) < 0.1, `4/4 at 180 BPM (1/8): ${interval8}ms (expected ${expected8}ms)`);
bpmController.stop();

// ===== Test Cleanup =====
console.log('\n=== Testing Cleanup ===');

const context5 = new MockAudioContext();
const gain5 = new MockGainNode();
const controller5 = new MetronomeController(context5, gain5);

controller5.start(120, '4/4', '1/4');
controller5.cleanup();
assert(!controller5.isRunning, 'Controller stopped after cleanup');

// ===== Test AudioContext Resume =====
console.log('\n=== Testing AudioContext Resume ===');

const suspendedContext = new MockAudioContext();
suspendedContext.state = 'suspended';
const gain6 = new MockGainNode();
const controller6 = new MetronomeController(suspendedContext, gain6);

controller6.start(120, '4/4', '1/4');
assert(suspendedContext.resumeCalled, 'AudioContext.resume() called when suspended');
controller6.stop();

// ===== Test Multiple Start/Stop Cycles =====
console.log('\n=== Testing Multiple Start/Stop Cycles ===');

const context7 = new MockAudioContext();
const gain7 = new MockGainNode();
const controller7 = new MetronomeController(context7, gain7);

for (let i = 0; i < 5; i++) {
    controller7.start(120, '4/4', '1/4');
    assert(controller7.isRunning, `Controller running after start cycle ${i + 1}`);
    controller7.stop();
    assert(!controller7.isRunning, `Controller stopped after stop cycle ${i + 1}`);
}

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
