import {ZodError} from 'zod';
import {StoreError} from './store.js';
import {approvedCategory,type ErrorDetail} from '../shared/errors.js';
export function serverErrorDetail(error:unknown):ErrorDetail{
  return {category:error instanceof ZodError?'invalid':error instanceof StoreError?approvedCategory(error.code):'unknown',
    outcome:error instanceof ZodError||error instanceof StoreError&&error.rejected?'rejected':'unconfirmed'};
}
