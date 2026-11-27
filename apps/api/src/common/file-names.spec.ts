import { cleanFileName, contentDisposition, withExtension } from './file-names';

describe('stored file names', () => {
  it('keeps Greek and other scripts', () => {
    expect(cleanFileName('Τιμολόγιο αγοράς.pdf')).toBe('Τιμολόγιο αγοράς.pdf');
    expect(cleanFileName('Фото 日本.jpg')).toBe('Фото 日本.jpg');
  });

  it('turns the %22 a browser sends back into a quote', () => {
    expect(cleanFileName('the %22red%22 car.jpg')).toBe('the "red" car.jpg');
  });

  it('drops folders, control characters and direction overrides', () => {
    expect(cleanFileName('../../etc/pass\r\nwd')).toBe('passwd');
    expect(cleanFileName('C:\\scans\\v5c.pdf')).toBe('v5c.pdf');
    expect(cleanFileName('invoice\u202efdp.exe')).toBe('invoicefdp.exe');
    expect(cleanFileName('..', 'photo')).toBe('photo');
    expect(cleanFileName('  ', 'photo')).toBe('photo');
  });

  it('cuts a long name and keeps its extension', () => {
    const name = cleanFileName(`${'α'.repeat(400)}.pdf`);
    expect(Array.from(name)).toHaveLength(200);
    expect(name.endsWith('α.pdf')).toBe(true);
  });

  it('changes an extension', () => {
    expect(withExtension('IMG_1.HEIC', 'jpg')).toBe('IMG_1.jpg');
    expect(withExtension('photo', 'jpg')).toBe('photo.jpg');
  });
});

describe('Content-Disposition', () => {
  it('cannot be broken by a quote or a new line', () => {
    expect(contentDisposition('attachment', 'a"; x=".pdf\r\nSet-Cookie')).toBe(
      'attachment; filename="a_; x=_.pdf__Set-Cookie"; ' +
        "filename*=UTF-8''a%22%3B%20x%3D%22.pdf%0D%0ASet-Cookie",
    );
  });

  it('carries a Greek name, in header safe characters only', () => {
    const header = contentDisposition('inline', "Φόρμα (1)'*.pdf");
    expect(header).toMatch(/^[\x20-\x7e]+$/);
    expect(decodeURIComponent(header.split("UTF-8''")[1])).toBe(
      "Φόρμα (1)'*.pdf",
    );
  });
});
