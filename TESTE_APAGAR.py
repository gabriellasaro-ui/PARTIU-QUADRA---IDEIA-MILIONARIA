import requests


# url = "https://api.qadras.com.br/api/auth/login"

# headers = {
#     "Content-Type": "application/json",
# }

# body = {
#     "email": "dono@arenabolanarede.com.br",
#     "senha": "qadras123"
# }

# response = requests.post(url, headers=headers, json=body)

# print(response.json())


url2 = "https://api.qadras.com.br/api/mercadopago/oauth/iniciar"

headers = {
    "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxZmQ2Y2ExZC0zY2FhLTQxZWEtOGNiYy1kZGZmMjNhNTk3YTMiLCJzaWQiOiJkM2RhZGJkMS05OGE4LTRjNTktOWVjZi0zMDJhOTViZmM1NDkiLCJqdGkiOiJkNjYxZmE2ZDViOTA0MWZiOWEwNzhjZDU2MzNiZTdmYSIsInR5cGUiOiJhY2Nlc3MiLCJpYXQiOjE3OTAxODIyNjQsImV4cCI6MTc5MDE4NTg2NH0.uwmc8U5f5Iz7bsONRi73w_qhaAdD88UCpDtaQ3NyZQY",
}

response = requests.get(url2, headers=headers)

print(response.json())

# {'url': 'https://auth.mercadopago.com.br/authorization?client_id=4990863695654229&response_type=code&platform_id=mp&redirect_uri=https%3A%2F%2Fapi.qadras.com.br%2Fapi%2Fmercadopago%2Foauth%2Fcallback&state=NGZkY2VkYmQtYzIyYy00YjU2LTgxNDQtNDJhNmI4NGEzODBiOjE3OTAxODIwMzk.b9a4568c1060957a25eb59623e2cd5f7ba6d88e6542e7ebd37020ac88836ce8b'}