'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { scheduleFor, SUBJECTS, TIME_ZONE } = require('../channelQuizScheduler');

test('weekly Channel quiz schedule uses Nigeria time and the agreed Saturday plan', () => {
  const plan = scheduleFor(new Date('2026-11-21T08:00:00.000Z')); // 09:00 WAT Saturday
  assert.equal(TIME_ZONE, 'Africa/Lagos');
  assert.equal(plan.hour, 9);
  assert.equal(plan.questionInterval, 3);
  assert.equal(plan.answerInterval, 3);
  assert.equal(plan.subjects.length, 10);
  assert.ok(plan.subjects.every(subject => subject.count === 10));
  assert.equal(plan.subjects.some(subject => subject.slug === 'english'), false);
});

test('weekday subject counts and intervals match the approved timetable', () => {
  const monday = scheduleFor(new Date('2026-11-16T09:00:00.000Z')); // 10:00 WAT
  const tuesday = scheduleFor(new Date('2026-11-17T09:00:00.000Z'));
  const friday = scheduleFor(new Date('2026-11-20T09:00:00.000Z'));
  assert.equal(monday.hour, 10);
  assert.equal(monday.subjects.length, 1);
  assert.equal(monday.subjects[0].count, 30);
  assert.equal(tuesday.subjects.length, 2);
  assert.equal(tuesday.questionInterval, 4);
  assert.equal(tuesday.answerInterval, 5);
  assert.deepEqual(friday.subjects.map(s => s.count), [20, 20, 20]);
  assert.equal(friday.subjects.some(subject => subject.slug === 'english'), false);
});

test('automatic schedule includes the agreed ten subjects only', () => {
  assert.deepEqual(SUBJECTS.map(s => s.slug), ['mathematics','biology','government','economics','chemistry','physics','crk','accounting','commerce','englishlit']);
});
