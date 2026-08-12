import type {CompileDiagnostic, ExpandedAction} from '@pose-clip/schemas';

export function optionalActionDropDiagnostics(actions: readonly ExpandedAction[]): CompileDiagnostic[] {
  return actions
    .filter(action => action.priority === 'optional')
    .map(action => ({
      id: `diagnostic.${action.id}.optional-dropped`,
      severity: 'info',
      code: 'OPTIONAL_ACTION_DROPPED',
      message: `Optional action ${action.id} omitted by M2 timing policy`,
      sourceId: action.sourceActionId,
      path: `/actions/${action.sourceActionId}`,
      recoverable: true,
    }));
}
