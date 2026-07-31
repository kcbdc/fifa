# v25 — "[object Object]" 원인 특정 및 수정

## 원인 확정

v24 진단 로그 덕분에 정확히 확인됐습니다: `res.response`가 **문자열이 아니라 객체**였고,
기존 코드는 `String(res.response)`로 강제 변환하고 있었습니다. JS에서 일반 객체를
`String()`으로 감싸면 실제 내용이 아니라 `"[object Object]"`라는 의미 없는 문자열이 나옵니다
(`obj.toString()`의 기본 동작). 즉 **AI 응답 자체는 정상적으로 왔는데, 그 안에서 실제 텍스트를
꺼내는 코드가 잘못돼 있었던 것**입니다.

## 수정

`extractAiText(res)` 함수를 새로 만들어 여러 가능한 응답 구조를 순서대로 확인하도록 했습니다:

1. `res.response` (문자열인 경우)
2. `res.result.response`
3. `res.choices[0].message.content` (OpenAI 호환 형식)
4. `res.output_text` / `res.result.output_text`
5. `res.generated_text`
6. 위에서 못 찾았는데 `res.response`가 객체/배열이면, 그 안의 `content`/`text` 필드나
   배열 원소들의 텍스트를 이어붙여서 시도
7. 그래도 못 찾으면 `JSON.stringify(res)`로 **실제 구조를 그대로** 반환(더 이상
   `"[object Object]"`가 나오지 않음)

6가지 그럴듯한 응답 형태(문자열 response, `{content}` 객체, `{text}` 객체, 청크 배열,
`result.response`, OpenAI 호환 `choices` 형식)로 직접 테스트해 전부 정상적으로 JSON 텍스트를
추출하는 것을 확인했습니다.

## 기대 결과

배포 후 다시 "최신 모형 자동 해설"을 눌렀을 때:
- **잘 되면** → `● AI 생성(모델명)` 배지와 함께 실제 AI 해설이 나옵니다.
- **여전히 안 되면** → 이번에는 에러 메시지에 `"[object Object]"` 대신 **실제 응답 구조**가
  그대로 찍히므로, 정확히 어떤 필드에 텍스트가 들어있는지 바로 알 수 있고 그에 맞춰 한 번 더
  정밀하게 고칠 수 있습니다.
