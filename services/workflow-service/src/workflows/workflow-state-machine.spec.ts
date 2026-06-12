import { ConflictException } from '@nestjs/common';
import { assertValidTransition } from './workflow-state-machine';
import { WorkflowStatus } from './entities/enums';

const S = WorkflowStatus;

describe('assertValidTransition', () => {
  // ─── Valid transitions ────────────────────────────────────────────────────

  const validPairs: [WorkflowStatus, WorkflowStatus][] = [
    [S.DRAFT,                     S.PENDING_APPROVAL],
    [S.PENDING_APPROVAL,          S.PENDING_REVIEW_CYCLE],
    [S.PENDING_APPROVAL,          S.REJECTED],
    [S.RETURNED_TO_CREATOR,       S.PENDING_APPROVAL],
    [S.PENDING_REVIEW_CYCLE,      S.ADMIN_CYCLE_IN_PROGRESS],
    [S.PENDING_REVIEW_CYCLE,      S.AVAILABLE_FOR_FINAL_USERS],
    [S.AVAILABLE_FOR_FINAL_USERS, S.ADMIN_CYCLE_IN_PROGRESS],
    [S.AVAILABLE_FOR_FINAL_USERS, S.CLOSED],
    [S.ADMIN_CYCLE_IN_PROGRESS,   S.AVAILABLE_FOR_FINAL_USERS],
  ];

  it.each(validPairs)(
    'allows %s → %s',
    (current, next) => {
      expect(() => assertValidTransition(current, next)).not.toThrow();
    },
  );

  // ─── Invalid transitions ──────────────────────────────────────────────────

  it('throws ConflictException for an illegal forward jump', () => {
    expect(() => assertValidTransition(S.DRAFT, S.CLOSED)).toThrow(ConflictException);
  });

  it('throws ConflictException when trying to leave terminal REJECTED', () => {
    expect(() => assertValidTransition(S.REJECTED, S.DRAFT)).toThrow(ConflictException);
  });

  it('throws ConflictException when trying to leave terminal CLOSED', () => {
    expect(() => assertValidTransition(S.CLOSED, S.DRAFT)).toThrow(ConflictException);
  });

  it('throws ConflictException when trying to leave terminal CANCELLED', () => {
    expect(() => assertValidTransition(S.CANCELLED, S.DRAFT)).toThrow(ConflictException);
  });

  it('error message names both the current and the attempted next state', () => {
    expect(() => assertValidTransition(S.DRAFT, S.CLOSED)).toThrow(
      /DRAFT.*CLOSED/,
    );
  });
});
