import { PageQuerySchema } from '@repo/core';
import { cursorPageArgs, toPage } from '../../src/common/pagination';

const A = '01JDZZ00000000000000000001';
const B = '01JDZZ00000000000000000002';
const C = '01JDZZ00000000000000000003';

describe('cursorPageArgs', () => {
  it('first page: no filter, limit + 1 look-ahead, newest first', () => {
    expect(cursorPageArgs(PageQuerySchema.parse({ limit: '2' }))).toEqual({
      take: 3,
      where: {},
      orderBy: { id: 'desc' },
    });
  });

  it('next page continues after the cursor in either direction', () => {
    const query = PageQuerySchema.parse({ cursor: B });
    expect(cursorPageArgs(query).where).toEqual({ id: { lt: B } });
    expect(cursorPageArgs(query, 'asc')).toMatchObject({
      where: { id: { gt: B } },
      orderBy: { id: 'asc' },
    });
  });
});

describe('toPage', () => {
  const query = PageQuerySchema.parse({ limit: '2' });

  it('drops the look-ahead row and points nextCursor at the last item', () => {
    expect(toPage([{ id: C }, { id: B }, { id: A }], query)).toEqual({
      items: [{ id: C }, { id: B }],
      nextCursor: B,
    });
  });

  it('returns a null cursor on the last page', () => {
    expect(toPage([{ id: B }, { id: A }], query)).toEqual({
      items: [{ id: B }, { id: A }],
      nextCursor: null,
    });
    expect(toPage([], query)).toEqual({ items: [], nextCursor: null });
  });
});
