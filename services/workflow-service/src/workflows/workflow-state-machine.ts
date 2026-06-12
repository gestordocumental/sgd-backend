import { ConflictException } from '@nestjs/common';
import { WorkflowStatus } from './entities/enums';

/**
 * Tabla centralizada de transiciones de estado válidas.
 *
 * DRAFT                     → PENDING_APPROVAL             (creator inicia aprobación)
 * PENDING_APPROVAL          → PENDING_REVIEW_CYCLE         (último aprobador aprueba)
 * PENDING_APPROVAL          → REJECTED                     (cualquier aprobador rechaza — terminal)
 * RETURNED_TO_CREATOR       → PENDING_APPROVAL             (legacy: creador reenvía tras rechazo)
 * PENDING_REVIEW_CYCLE      → ADMIN_CYCLE_IN_PROGRESS      (usuario final crea ciclo administrativo)
 * PENDING_REVIEW_CYCLE      → AVAILABLE_FOR_FINAL_USERS    (usuario final omite ciclo de revisión)
 * AVAILABLE_FOR_FINAL_USERS → ADMIN_CYCLE_IN_PROGRESS      (nuevo ciclo administrativo iniciado desde estado disponible)
 * AVAILABLE_FOR_FINAL_USERS → CLOSED                       (usuario final cierra el workflow)
 * ADMIN_CYCLE_IN_PROGRESS   → AVAILABLE_FOR_FINAL_USERS    (último paso admin completado)
 *
 * Estados terminales: REJECTED, CLOSED, CANCELLED
 */
export const VALID_TRANSITIONS: Record<WorkflowStatus, WorkflowStatus[]> = {
  [WorkflowStatus.DRAFT]:                     [WorkflowStatus.PENDING_APPROVAL],
  [WorkflowStatus.PENDING_APPROVAL]:          [WorkflowStatus.PENDING_REVIEW_CYCLE, WorkflowStatus.REJECTED],
  [WorkflowStatus.RETURNED_TO_CREATOR]:       [WorkflowStatus.PENDING_APPROVAL],
  [WorkflowStatus.REJECTED]:                  [],
  [WorkflowStatus.PENDING_REVIEW_CYCLE]:      [WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS, WorkflowStatus.AVAILABLE_FOR_FINAL_USERS],
  [WorkflowStatus.AVAILABLE_FOR_FINAL_USERS]: [WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS, WorkflowStatus.CLOSED],
  [WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS]:   [WorkflowStatus.AVAILABLE_FOR_FINAL_USERS],
  [WorkflowStatus.CLOSED]:                    [],
  [WorkflowStatus.CANCELLED]:                 [],
};

/**
 * Valida que la transición de estado sea válida según el grafo definido.
 * Lanza ConflictException si la transición no está permitida.
 */
export function assertValidTransition(current: WorkflowStatus, next: WorkflowStatus): void {
  if (!VALID_TRANSITIONS[current]?.includes(next)) {
    throw new ConflictException(
      `Invalid workflow state transition: cannot go from ${current} to ${next}`,
    );
  }
}
