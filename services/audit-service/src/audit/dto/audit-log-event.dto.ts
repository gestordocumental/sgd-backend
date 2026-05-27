/**
 * Forma del mensaje publicado al tópico audit.log por cualquier microservicio.
 * El workflow-service emite este payload desde WorkflowTimelineService.emitAuditLog().
 */
export interface AuditLogEvent {
  service:        string;
  actorId:        string;
  orgId:          string | null;
  action:         string;
  resourceType:   string;
  resourceId:     string;
  resourceName?:  string | null;
  metadata:       Record<string, unknown> | null;
  timestamp:      string;
  correlationId?: string | null;
  ip?:            string | null;
}

/**
 * Determine whether a value conforms to the AuditLogEvent shape.
 *
 * @param raw - The value to validate
 * @returns `true` if `raw` has the required string fields `service`, `actorId`, `action`, `resourceType`, `resourceId`, and `timestamp`, and the optional fields meet their allowed types/nullable states; `false` otherwise. Optional fields: `orgId` may be `null` or a string; `resourceName`, `correlationId`, and `ip` may be `undefined`, `null`, or a string; `metadata` may be `undefined` or `null` or a non-array object.
 */
export function isValidAuditLogEvent(raw: unknown): raw is AuditLogEvent {
  if (!raw || typeof raw !== 'object') return false;
  const p = raw as Record<string, unknown>;
  return (
    typeof p['service']      === 'string' &&
    typeof p['actorId']      === 'string' &&
    (p['orgId'] === null || typeof p['orgId'] === 'string') &&
    typeof p['action']       === 'string' &&
    typeof p['resourceType'] === 'string' &&
    typeof p['resourceId']   === 'string' &&
    typeof p['timestamp']    === 'string' &&
    (p['resourceName']  === undefined || p['resourceName']  === null || typeof p['resourceName']  === 'string') &&
    (p['metadata']      === undefined || p['metadata']      === null || (typeof p['metadata'] === 'object' && !Array.isArray(p['metadata']))) &&
    (p['correlationId'] === undefined || p['correlationId'] === null || typeof p['correlationId'] === 'string') &&
    (p['ip']            === undefined || p['ip']            === null || typeof p['ip']            === 'string')
  );
}
