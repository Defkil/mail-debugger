import { measureSource } from './mailbox-adapter.js';

describe('measureSource', () => {
  it('counts the octets IMAP serves and the header section', () => {
    expect(measureSource('A: b\r\n\r\nbody')).toEqual({
      octets: 12,
      headerOctets: 8,
    });
  });

  it('counts a CR for every bare LF', () => {
    // ImapKit serves "A: b\r\n\r\nx\r\ny"
    expect(measureSource('A: b\n\nx\ny')).toEqual({
      octets: 12,
      headerOctets: 8,
    });
    expect(measureSource('A: b\r\n\nx')).toEqual({
      octets: 9,
      headerOctets: 8,
    });
  });

  it('treats a source without an empty line as all header', () => {
    expect(measureSource('A: b\r\nC: d')).toEqual({
      octets: 10,
      headerOctets: 10,
    });
    expect(measureSource('')).toEqual({ octets: 0, headerOctets: 0 });
  });
});
