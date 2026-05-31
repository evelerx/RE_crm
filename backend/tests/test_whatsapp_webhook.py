from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_whatsapp_webhook_verification_rejects_wrong_token():
    response = client.get(
        "/whatsapp/webhook",
        params={
            "hub.mode": "subscribe",
            "hub.challenge": "12345",
            "hub.verify_token": "wrong-token",
        },
    )
    assert response.status_code == 403


def test_whatsapp_webhook_accepts_malformed_payload_without_crashing():
    response = client.post("/whatsapp/webhook", json={"entry": [{"changes": [{"value": {"messages": [{}]}}]}]})
    assert response.status_code == 200
    assert response.json() == {"received": True}
