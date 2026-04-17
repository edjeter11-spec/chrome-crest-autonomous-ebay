from pydantic import BaseModel
from typing import Optional

class CardAnalysisRequest(BaseModel):
    card_id: int
    context: Optional[str] = ""

class WishlistCreate(BaseModel):
    card_id: int
    max_price: float
    priority: int = 3
    notes: Optional[str] = None
    auto_snipe: bool = False

class AlertCreate(BaseModel):
    card_id: int
    alert_type: str
    threshold_price: float

class PortfolioCreate(BaseModel):
    card_id: int
    purchase_price: float
    quantity: int = 1
    notes: Optional[str] = None
