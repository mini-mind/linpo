export function formatSourceLabel(source) {
  if (source === 'external_registration') {
    return '外部';
  }
  return '本地';
}

export function formatRegistrationStatusLabel(status) {
  if (status === 'pending_review') {
    return '待审核';
  }
  if (status === 'approved') {
    return '已通过审核';
  }
  if (status === 'rejected') {
    return '已拒绝';
  }
  return '状态未知';
}

export function buildClawOptionLabel(claw) {
  const sourceLabel = formatSourceLabel(claw.source);
  if (claw.source === 'external_registration') {
    return `${claw.name}（${sourceLabel} | ${formatRegistrationStatusLabel(claw.registration_status)}）`;
  }
  return `${claw.name}（${sourceLabel}）`;
}
