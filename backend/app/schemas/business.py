import uuid
from datetime import date, datetime
from decimal import Decimal
from pydantic import BaseModel, EmailStr, Field
from app.schemas.common import ORM


class CategoryOut(ORM):
    id: uuid.UUID; name: str; description: str


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=120); description: str = ""


class ProductIn(BaseModel):
    sku: str = Field(min_length=1, max_length=40); name: str = Field(min_length=1, max_length=200)
    description: str = ""; category_id: uuid.UUID; manufacturer: str = ""; unit_of_measure: str = "each"
    unit_price: Decimal = Field(ge=0); is_active: bool = True


class ProductUpdate(BaseModel):
    name: str | None = None; description: str | None = None; category_id: uuid.UUID | None = None
    manufacturer: str | None = None; unit_of_measure: str | None = None
    unit_price: Decimal | None = Field(default=None, ge=0); is_active: bool | None = None


class ProductOut(ORM):
    id: uuid.UUID; sku: str; name: str; description: str; manufacturer: str; unit_of_measure: str
    unit_price: Decimal; is_active: bool; category_id: uuid.UUID; category: CategoryOut
    created_at: datetime; updated_at: datetime


class SupplierIn(BaseModel):
    code: str = Field(min_length=1, max_length=20); name: str = Field(min_length=1, max_length=200)
    contact_person: str = ""; email: EmailStr | None = None; phone: str = ""; address: str = ""; country: str = ""
    payment_terms: str = "Net 30"; avg_lead_time_days: int = Field(default=14, ge=0, le=365)
    rating: Decimal = Field(default=Decimal("3.5"), ge=0, le=5); is_active: bool = True


class SupplierUpdate(BaseModel):
    name: str | None = None; contact_person: str | None = None; email: EmailStr | None = None; phone: str | None = None
    address: str | None = None; country: str | None = None; payment_terms: str | None = None
    avg_lead_time_days: int | None = Field(default=None, ge=0, le=365); rating: Decimal | None = Field(default=None, ge=0, le=5)
    is_active: bool | None = None


class SupplierOut(ORM):
    id: uuid.UUID; code: str; name: str; contact_person: str; email: str; phone: str; address: str; country: str
    payment_terms: str; avg_lead_time_days: int; rating: Decimal; is_active: bool


class SupplierProductOut(BaseModel):
    product_id: uuid.UUID; sku: str; product_name: str; unit_price: Decimal; lead_time_days: int
    min_order_qty: int; is_preferred: bool


class WarehouseOut(ORM):
    id: uuid.UUID; code: str; name: str; location: str


class InventoryOut(BaseModel):
    id: uuid.UUID; product_id: uuid.UUID; sku: str; product_name: str; warehouse_id: uuid.UUID; warehouse: str
    quantity_on_hand: int; quantity_reserved: int; quantity_on_order: int; reorder_level: int; safety_stock: int
    avg_daily_demand: Decimal; available: int; projected: int; days_of_cover: float | None; low_stock: bool
    updated_at: datetime


class InventoryAdjust(BaseModel):
    quantity: int  # signed delta applied to on-hand
    reason: str = Field(min_length=1, max_length=80)


class MovementOut(ORM):
    id: uuid.UUID; movement_type: str; quantity: int; reference: str; occurred_at: datetime


class ReorderRecommendation(BaseModel):
    product_id: uuid.UUID; sku: str; product_name: str; warehouse: str; warehouse_id: uuid.UUID; available: int; projected: int
    days_of_cover: float | None; suggested_quantity: int
    supplier_id: uuid.UUID | None; supplier_name: str | None; lead_time_days: int | None; unit_price: Decimal | None


class POLineOut(ORM):
    id: uuid.UUID; product_id: uuid.UUID; product_sku: str; product_name: str; quantity: int; quantity_received: int; unit_price: Decimal
    tax_rate: Decimal; line_total: Decimal


class POHistoryOut(ORM):
    from_status: str | None; to_status: str; changed_at: datetime; note: str


class POOut(ORM):
    id: uuid.UUID; po_number: str; supplier_id: uuid.UUID; supplier_name: str; warehouse_id: uuid.UUID; warehouse_name: str; status: str; order_date: date
    expected_delivery_date: date; actual_delivery_date: date | None; subtotal: Decimal; tax_amount: Decimal
    total_amount: Decimal


class PODetail(POOut):
    lines: list[POLineOut]; history: list[POHistoryOut]


class POLineIn(BaseModel):
    product_id: uuid.UUID; quantity: int = Field(gt=0)


class POCreate(BaseModel):
    supplier_id: uuid.UUID; warehouse_id: uuid.UUID; lines: list[POLineIn] = Field(min_length=1)
    expected_delivery_date: date | None = None


class POStatusChange(BaseModel):
    to_status: str; note: str = ""


class RequestLineIn(BaseModel):
    product_id: uuid.UUID; quantity: int = Field(gt=0); suggested_supplier_id: uuid.UUID | None = None


class RequestLineOut(ORM):
    id: uuid.UUID; product_id: uuid.UUID; product_sku: str; product_name: str; quantity: int
    suggested_supplier_id: uuid.UUID | None; suggested_supplier_name: str | None


class RequestCreate(BaseModel):
    justification: str = Field(min_length=1); priority: str = Field(default="medium", pattern="^(low|medium|high|urgent)$")
    requested_delivery_date: date | None = None; lines: list[RequestLineIn] = Field(min_length=1)


class RequestOut(ORM):
    id: uuid.UUID; request_number: str; justification: str; priority: str; status: str
    requested_delivery_date: date | None; created_at: datetime; lines: list[RequestLineOut]


class DecisionIn(BaseModel):
    comment: str = ""


class ApprovalHistoryOut(ORM):
    action: str; actor_id: uuid.UUID | None; actor_name: str | None; comment: str; acted_at: datetime
