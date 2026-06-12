import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ResubmitWorkflowDto } from './resubmit-workflow.dto';

describe('ResubmitWorkflowDto', () => {
  it('trims observations and accepts a valid resubmit payload', async () => {
    const dto = plainToInstance(ResubmitWorkflowDto, {
      observations: '  fixed requested changes  ',
      updatedMainDocumentId: 'doc-1',
      newAttachmentIds: ['att-1', 'att-2'],
    });

    expect(dto.observations).toBe('fixed requested changes');
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects invalid lengths and attachment shapes', async () => {
    const dto = plainToInstance(ResubmitWorkflowDto, {
      observations: 'x'.repeat(2001),
      updatedMainDocumentId: 'x'.repeat(256),
      newAttachmentIds: 'att-1',
    });

    const errors = await validate(dto);
    const properties = errors.map((error) => error.property);

    expect(properties).toEqual(
      expect.arrayContaining([
        'observations',
        'updatedMainDocumentId',
        'newAttachmentIds',
      ]),
    );
  });
});
