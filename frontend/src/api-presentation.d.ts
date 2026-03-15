export type ApiPresentationSource = 'fixture' | 'external_registration' | undefined;
export type ApiPresentationRegistrationStatus =
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | undefined;

export interface ApiPresentationClaw {
  name: string;
  source?: ApiPresentationSource;
  registration_status?: ApiPresentationRegistrationStatus;
}

export declare function formatSourceLabel(source: ApiPresentationSource): string;

export declare function formatRegistrationStatusLabel(
  status: ApiPresentationRegistrationStatus,
): string;

export declare function buildClawOptionLabel(claw: ApiPresentationClaw): string;
