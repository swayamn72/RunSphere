import { Type, type Static } from '@sinclair/typebox';
import { EmailSchema, Strict } from './common.js';

const TokenSchema = Type.String({ minLength: 32, maxLength: 1024 });

export const PasswordResetRequestSchema = Type.Object(
  { email: EmailSchema },
  { ...Strict, $id: 'PasswordResetRequest' }
);
export const PasswordResetRequestedResponseSchema = Type.Object(
  { status: Type.Literal('requested') },
  { $id: 'PasswordResetRequestedResponse' }
);
export const PasswordResetCompleteRequestSchema = Type.Object(
  { token: TokenSchema, newPassword: Type.String({ minLength: 12, maxLength: 256 }) },
  { ...Strict, $id: 'PasswordResetCompleteRequest' }
);

export const EmailChangeRequestSchema = Type.Object(
  { newEmail: EmailSchema },
  { ...Strict, $id: 'EmailChangeRequest' }
);
export const EmailChangeRequestedResponseSchema = Type.Object(
  { status: Type.Literal('requested') },
  { $id: 'EmailChangeRequestedResponse' }
);
export const EmailChangeCompleteRequestSchema = Type.Object(
  { token: TokenSchema },
  { ...Strict, $id: 'EmailChangeCompleteRequest' }
);

export const PublicDeletionRequestSchema = Type.Object(
  { email: EmailSchema },
  { ...Strict, $id: 'PublicDeletionRequest' }
);
export const PublicDeletionRequestedResponseSchema = Type.Object(
  { status: Type.Literal('requested') },
  { $id: 'PublicDeletionRequestedResponse' }
);
export const PublicDeletionCompleteRequestSchema = Type.Object(
  { token: TokenSchema },
  { ...Strict, $id: 'PublicDeletionCompleteRequest' }
);

export const StaffRolesResponseSchema = Type.Object(
  { roles: Type.Array(Type.String({ minLength: 1, maxLength: 32 }), { maxItems: 8 }) },
  { $id: 'StaffRolesResponse' }
);

export type PasswordResetRequest = Static<typeof PasswordResetRequestSchema>;
export type PasswordResetRequestedResponse = Static<typeof PasswordResetRequestedResponseSchema>;
export type PasswordResetCompleteRequest = Static<typeof PasswordResetCompleteRequestSchema>;
export type EmailChangeRequest = Static<typeof EmailChangeRequestSchema>;
export type EmailChangeRequestedResponse = Static<typeof EmailChangeRequestedResponseSchema>;
export type EmailChangeCompleteRequest = Static<typeof EmailChangeCompleteRequestSchema>;
export type PublicDeletionRequest = Static<typeof PublicDeletionRequestSchema>;
export type PublicDeletionRequestedResponse = Static<typeof PublicDeletionRequestedResponseSchema>;
export type PublicDeletionCompleteRequest = Static<typeof PublicDeletionCompleteRequestSchema>;
export type StaffRolesResponse = Static<typeof StaffRolesResponseSchema>;
