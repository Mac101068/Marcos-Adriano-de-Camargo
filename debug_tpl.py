from fastapi.templating import Jinja2Templates
from starlette.requests import Request

templates = Jinja2Templates(directory="templates")
scope = {
    'type': 'http',
    'method': 'GET',
    'path': '/',
    'headers': [],
    'query_string': b'',
    'server': ('127.0.0.1', 8000),
    'scheme': 'http',
}
async def receive():
    return {'type': 'http.request', 'body': b''}
req = Request(scope, receive)
try:
    resp = templates.TemplateResponse('index.html', {'request': req})
    print(resp.status_code)
    print(resp.body[:80])
except Exception as e:
    print(type(e).__name__)
    print(e)
    import traceback
    traceback.print_exc()
