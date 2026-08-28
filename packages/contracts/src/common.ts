import { Type } from '@sinclair/typebox';

export const UuidSchema = Type.String({ format: 'uuid' });
export const Strict = { additionalProperties: false };
export const DateSchema = Type.String({ format: 'date' });
export const DateTimeSchema = Type.String({ format: 'date-time' });
export const EmailSchema = Type.String({ format: 'email', maxLength: 320 });

/** Error envelope reused across new routes; mirrors the existing ErrorResponseSchema. */
export const ErrorSchema = Type.Object({ message: Type.String() }, { $id: 'Error' });
