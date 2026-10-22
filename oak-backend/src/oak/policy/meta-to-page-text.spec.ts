import { metaToPageText } from './meta-to-page-text';

describe('metaToPageText', () => {
  it('passes through a string meta field', () => {
    expect(metaToPageText('  Staff engineer. Build APIs.  ')).toBe(
      'Staff engineer. Build APIs.',
    );
  });

  it('extracts visible text from a DOM-like meta tree', () => {
    const text = metaToPageText({
      tag: 'body',
      title: 'Acme',
      url: 'https://jobs.example/1',
      children: [
        { tag: 'h1', text: 'Staff engineer', children: [] },
        { tag: 'p', text: 'Own the platform.', children: [] },
        { tag: 'button', text: 'Apply', children: [] },
      ],
    });
    expect(text).toContain('Acme');
    expect(text).toContain('Staff engineer');
    expect(text).toContain('Own the platform.');
    expect(text).not.toContain('Apply');
  });

  it('unwraps { metaTree } objects', () => {
    expect(metaToPageText({ metaTree: 'Role: builder' })).toBe('Role: builder');
  });
});
