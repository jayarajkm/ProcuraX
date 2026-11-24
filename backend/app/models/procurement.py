import uuid
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database.base import Base, IdMixin, TimestampMixin
from app.models.catalogue import Product, Supplier, Warehouse
from app.models.identity import User

PO_STATUSES = ("draft", "pending_approval", "approved", "sent", "partially_received", "received", "cancelled")
REQUEST_STATUSES = ("draft", "submitted", "pending_approval", "approved", "rejected", "converted")


class PurchaseOrder(IdMixin, TimestampMixin, Base):
    __tablename__ = "purchase_orders"
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    po_number: Mapped[str] = mapped_column(String(30), unique=True)
    supplier_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("suppliers.id"), index=True)
    warehouse_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("warehouses.id"), index=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(30), index=True, default="draft")
    order_date: Mapped[date] = mapped_column(Date)
    expected_delivery_date: Mapped[date] = mapped_column(Date)
    actual_delivery_date: Mapped[date | None] = mapped_column(Date)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    source_request_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("purchase_requests.id"))
    supplier: Mapped["Supplier"] = relationship(lazy="joined")
    warehouse: Mapped["Warehouse"] = relationship(lazy="joined")
    lines: Mapped[list["PurchaseOrderLine"]] = relationship(back_populates="order", cascade="all, delete-orphan", lazy="selectin")
    history: Mapped[list["PurchaseOrderStatusHistory"]] = relationship(cascade="all, delete-orphan", lazy="selectin")
    __table_args__ = (
        CheckConstraint("status IN ('draft','pending_approval','approved','sent','partially_received','received','cancelled')"),
    )

    @property
    def supplier_name(self) -> str: return self.supplier.name
    @property
    def warehouse_name(self) -> str: return self.warehouse.name


class PurchaseOrderLine(IdMixin, Base):
    __tablename__ = "purchase_order_lines"
    purchase_order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("purchase_orders.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id"), index=True)
    quantity: Mapped[int] = mapped_column(Integer)
    quantity_received: Mapped[int] = mapped_column(Integer, default=0)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(5, 4), default=Decimal("0.10"))
    line_total: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    order: Mapped[PurchaseOrder] = relationship(back_populates="lines")
    product: Mapped["Product"] = relationship(lazy="joined")

    @property
    def product_sku(self) -> str: return self.product.sku
    @property
    def product_name(self) -> str: return self.product.name
    __table_args__ = (CheckConstraint("quantity > 0 AND quantity_received >= 0 AND quantity_received <= quantity"),)


class PurchaseOrderStatusHistory(IdMixin, Base):
    __tablename__ = "purchase_order_status_history"
    purchase_order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("purchase_orders.id", ondelete="CASCADE"), index=True)
    from_status: Mapped[str | None] = mapped_column(String(30))
    to_status: Mapped[str] = mapped_column(String(30))
    changed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    note: Mapped[str] = mapped_column(String(300), default="")


class PurchaseRequest(IdMixin, TimestampMixin, Base):
    __tablename__ = "purchase_requests"
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    request_number: Mapped[str] = mapped_column(String(30), unique=True)
    requested_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    justification: Mapped[str] = mapped_column(Text, default="")
    priority: Mapped[str] = mapped_column(String(20), default="medium")
    status: Mapped[str] = mapped_column(String(30), index=True, default="draft")
    requested_delivery_date: Mapped[date | None] = mapped_column(Date)
    created_by_agent_execution_id: Mapped[uuid.UUID | None] = mapped_column()  # soft ref to agent_executions
    lines: Mapped[list["PurchaseRequestLine"]] = relationship(cascade="all, delete-orphan", lazy="selectin")
    __table_args__ = (
        CheckConstraint("status IN ('draft','submitted','pending_approval','approved','rejected','converted')"),
        CheckConstraint("priority IN ('low','medium','high','urgent')"),
    )


class PurchaseRequestLine(IdMixin, Base):
    __tablename__ = "purchase_request_lines"
    purchase_request_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("purchase_requests.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id"), index=True)
    suggested_supplier_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("suppliers.id"))
    quantity: Mapped[int] = mapped_column(Integer)
    product: Mapped["Product"] = relationship(lazy="joined")
    suggested_supplier: Mapped["Supplier | None"] = relationship(lazy="joined")
    __table_args__ = (CheckConstraint("quantity > 0"),)

    @property
    def product_sku(self) -> str: return self.product.sku
    @property
    def product_name(self) -> str: return self.product.name
    @property
    def suggested_supplier_name(self) -> str | None: return self.suggested_supplier.name if self.suggested_supplier else None


class ApprovalWorkflow(IdMixin, TimestampMixin, Base):
    __tablename__ = "approval_workflows"
    entity_type: Mapped[str] = mapped_column(String(30))  # purchase_request | purchase_order
    entity_id: Mapped[uuid.UUID] = mapped_column(index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|approved|rejected
    required_permission: Mapped[str] = mapped_column(String(80))
    __table_args__ = (UniqueConstraint("entity_type", "entity_id"),)


class ApprovalHistory(IdMixin, Base):
    __tablename__ = "approval_history"
    workflow_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("approval_workflows.id", ondelete="CASCADE"), index=True)
    action: Mapped[str] = mapped_column(String(30))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    comment: Mapped[str] = mapped_column(String(500), default="")
    acted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    actor: Mapped["User | None"] = relationship(lazy="joined")

    @property
    def actor_name(self) -> str | None: return self.actor.full_name if self.actor else None
