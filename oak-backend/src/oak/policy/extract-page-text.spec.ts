import {
  PAGE_TEXT_MAX_CHARS,
  extractVisiblePageText,
} from './extract-page-text';

describe('extractVisiblePageText', () => {
  it('prefixes title and url and keeps body text', () => {
    const text = extractVisiblePageText(
      {
        tag: 'body',
        children: [
          { tag: 'h1', text: 'Staff engineer', children: [] },
          { tag: 'p', text: 'Build the platform.', children: [] },
        ],
      },
      { title: 'Acme role', url: 'https://jobs.example/1' },
    );
    expect(text.startsWith('Acme role\n\nhttps://jobs.example/1\n\n')).toBe(
      true,
    );
    expect(text).toContain('Staff engineer');
    expect(text).toContain('Build the platform.');
  });

  it('drops form chrome text', () => {
    const text = extractVisiblePageText({
      tag: 'form',
      children: [
        { tag: 'p', text: 'About the role', children: [] },
        { tag: 'input', text: 'email@example.com', children: [] },
        { tag: 'button', text: 'Submit', children: [] },
        { tag: 'select', text: 'Choose', children: [] },
      ],
    });
    expect(text).toBe('About the role');
    expect(text).not.toContain('email@example.com');
    expect(text).not.toContain('Submit');
  });

  it('returns empty when there is no body text', () => {
    expect(
      extractVisiblePageText(
        { tag: 'input', text: 'hidden', children: [] },
        { title: 'Empty', url: 'https://x' },
      ),
    ).toBe('');
  });

  it('caps length', () => {
    const text = extractVisiblePageText({
      tag: 'p',
      text: 'x'.repeat(PAGE_TEXT_MAX_CHARS + 50),
      children: [],
    });
    expect(text.length).toBe(PAGE_TEXT_MAX_CHARS);
  });
});
