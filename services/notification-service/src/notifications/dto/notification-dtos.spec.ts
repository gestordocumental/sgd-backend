import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListNotificationsDto } from './list-notifications.dto';
import { NotificationEventDto } from './notification-event.dto';

describe('notification DTOs', () => {
  describe('ListNotificationsDto', () => {
    it('uses default pagination values', () => {
      const dto = new ListNotificationsDto();

      expect(dto.page).toBe(1);
      expect(dto.limit).toBe(20);
    });

    it('transforms numeric and boolean query values', async () => {
      const dto = plainToInstance(ListNotificationsDto, {
        page: '2',
        limit: '50',
        unreadOnly: 'true',
      });

      await expect(validate(dto)).resolves.toHaveLength(0);
      expect(dto).toMatchObject({ page: 2, limit: 50, unreadOnly: true });
    });

    it('transforms false string to boolean false', async () => {
      const dto = plainToInstance(ListNotificationsDto, {
        unreadOnly: 'false',
      });

      await expect(validate(dto)).resolves.toHaveLength(0);
      expect(dto.unreadOnly).toBe(false);
    });

    it('keeps invalid boolean values so validation can fail', async () => {
      const dto = plainToInstance(ListNotificationsDto, {
        unreadOnly: 'yes',
      });

      const errors = await validate(dto);

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('unreadOnly');
    });
  });

  describe('NotificationEventDto', () => {
    it('validates a complete notification event', async () => {
      const dto = plainToInstance(NotificationEventDto, {
        type: 'WORKFLOW_APPROVED',
        recipientUserIds: ['11111111-1111-4111-8111-111111111111'],
        orgId: '22222222-2222-4222-8222-222222222222',
        orgName: 'Acme',
        workflowId: '33333333-3333-4333-8333-333333333333',
        workflowTitle: 'Workflow demo',
        message: 'Approved',
        metadata: { source: 'test' },
        timestamp: '2026-01-01T00:00:00.000Z',
      });

      await expect(validate(dto)).resolves.toHaveLength(0);
    });

    it('rejects an invalid notification event', async () => {
      const dto = plainToInstance(NotificationEventDto, {
        type: 'UNKNOWN',
        recipientUserIds: ['not-a-uuid'],
        message: '',
      });

      const errors = await validate(dto);

      expect(errors.map((error) => error.property)).toEqual(
        expect.arrayContaining(['type', 'recipientUserIds', 'message']),
      );
    });
  });
});
