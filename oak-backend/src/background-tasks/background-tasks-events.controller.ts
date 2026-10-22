import { Controller, MessageEvent, Query, Sse } from '@nestjs/common';
import { Observable, interval, merge, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { BackgroundTasksService } from './background-tasks.service';
import { SSE_HEARTBEAT_MS, SSE_POLL_MS } from './constants/task-types';

@Controller('background-tasks')
export class BackgroundTasksEventsController {
  constructor(private readonly tasks: BackgroundTasksService) {}

  @Sse('events')
  events(@Query('profileId') profileId: string): Observable<MessageEvent> {
    const pid = String(profileId || '').trim();
    let since = new Date(0);

    const snapshot$ = of(null).pipe(
      switchMap(async () => {
        const listed = await this.tasks.list({
          profileId: pid || undefined,
          limit: 50,
        });
        since = new Date();
        return {
          type: 'snapshot',
          data: { tasks: listed.tasks },
        };
      }),
    );

    const updates$ = interval(SSE_POLL_MS).pipe(
      switchMap(async () => {
        if (!pid) return [] as MessageEvent[];
        const store = this.tasks.getStore();
        const changed = await store.listSince(pid, since);
        if (!changed.length) return [] as MessageEvent[];
        since = new Date();
        return changed.map((task) => ({
          type: 'task-updated',
          data: { task: store.toPublic(task) },
        }));
      }),
      switchMap((events) => of(...events)),
    );

    const heartbeat$ = interval(SSE_HEARTBEAT_MS).pipe(
      map(() => ({
        type: 'heartbeat',
        data: { at: new Date().toISOString() },
      })),
    );

    return merge(snapshot$, updates$, heartbeat$);
  }
}
