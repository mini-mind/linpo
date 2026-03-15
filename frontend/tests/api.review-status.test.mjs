import assert from 'node:assert/strict';
import {
  buildClawOptionLabel,
  formatRegistrationStatusLabel,
  formatSourceLabel,
} from '../src/api-presentation.js';

assert.equal(formatSourceLabel('fixture'), '本地');
assert.equal(formatSourceLabel('external_registration'), '外部');

assert.equal(
  buildClawOptionLabel({
    id: 'external-approved',
    name: '远端辩手',
    endpoint_ref: 'remote:approved',
    inbox_url: 'https://remote.example/inbox',
    enabled: true,
    source: 'external_registration',
    registration_status: 'approved',
  }),
  '远端辩手（外部 | 已通过审核）',
);

assert.equal(
  buildClawOptionLabel({
    id: 'fixture-1',
    name: '本地示例',
    endpoint_ref: 'fixture:demo',
    inbox_url: null,
    enabled: true,
    source: 'fixture',
  }),
  '本地示例（本地）',
);

assert.equal(
  buildClawOptionLabel({
    id: 'external-unknown',
    name: '待确认外部辩手',
    endpoint_ref: 'remote:unknown',
    inbox_url: 'https://remote.example/inbox',
    enabled: true,
    source: 'external_registration',
  }),
  '待确认外部辩手（外部 | 状态未知）',
);

assert.equal(formatRegistrationStatusLabel('pending_review'), '待审核');
assert.equal(formatRegistrationStatusLabel('approved'), '已通过审核');
assert.equal(formatRegistrationStatusLabel('rejected'), '已拒绝');
assert.equal(formatRegistrationStatusLabel(undefined), '状态未知');

console.log('review-status presentation helpers pass');
