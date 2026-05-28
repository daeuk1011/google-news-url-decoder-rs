export const VALID_HTML = `
<html><body>
  <c-wiz>
    <div jscontroller="abc" data-n-a-sg="TESTSIG" data-n-a-ts="1700000000">x</div>
  </c-wiz>
</body></html>
`;

export const VALID_BATCH_RESPONSE =
  ")]}'\n\n" +
  '[[null,null,"[\\"x\\",\\"https://example.com/article\\"]"],"trail1","trail2"]';

export const HTML_WITHOUT_PARAMS = "<html><body><c-wiz></c-wiz></body></html>";

export const MALFORMED_BATCH_RESPONSE = "garbage";

export const VALID_NEWS_URL =
  "https://news.google.com/articles/CBMiTESTBASE64?hl=en-US&gl=US&ceid=US%3Aen";

export function makeFetchMock(responses) {
  // responses: array of { match: (url) => boolean, ok?, status?, text? }
  return async (url, _init) => {
    for (const r of responses) {
      if (r.match(url)) {
        return {
          ok: r.ok ?? true,
          status: r.status ?? 200,
          text: async () => r.text ?? "",
        };
      }
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
}
