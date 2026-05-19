import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AppLogger } from '../../common/logger/app-logger.service';
import { getCorrelationId } from '../../common/correlation/correlation.context';

interface UserInfo {
  id: string;
  email: string;
  fullName: string;
}

@Injectable()
export class UserClientService {
  private readonly baseUrl: string;
  private readonly internalToken: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.baseUrl       = config.getOrThrow<string>('USER_SERVICE_URL');
    this.internalToken = config.getOrThrow<string>('INTERNAL_TOKEN');
  }

  async getUserById(userId: string): Promise<UserInfo | null> {
    try {
      const { data } = await firstValueFrom(
        this.http.get<UserInfo>(`${this.baseUrl}/api/users/${userId}`, {
          timeout: 3000,
          headers: {
            'x-internal-token':  this.internalToken,
            'x-correlation-id':  getCorrelationId(),
          },
        }),
      );
      return data;
    } catch (err) {
      this.logger.warn(
        `Could not fetch user ${userId}: ${err instanceof Error ? err.message : String(err)}`,
        'UserClientService',
      );
      return null;
    }
  }

  async getUsersByIds(userIds: string[]): Promise<Map<string, UserInfo>> {
    const results = await Promise.all(userIds.map((id) => this.getUserById(id)));
    const map = new Map<string, UserInfo>();
    results.forEach((user, idx) => {
      if (user) map.set(userIds[idx], user);
    });
    return map;
  }
}
