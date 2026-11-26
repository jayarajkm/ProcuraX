import {
  BarChart3, Bot, BrainCircuit, ClipboardList, FileText, GitCompare, LayoutDashboard, Library, Package, Settings, ShieldCheck,
  ShoppingCart, Tags, Truck, Warehouse, PackageSearch, Building2, Workflow, type LucideIcon,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { AdminPage } from '@/pages/AdminPage'
import { AgentPage } from '@/pages/AgentPage'
import { AIAnalyticsPage } from '@/pages/AIAnalyticsPage'
import { ChatbotsPage } from '@/pages/ChatbotsPage'
import { ChatPlaygroundPage } from '@/pages/ChatPlaygroundPage'
import { ComparePage } from '@/pages/ComparePage'
import { DocumentsPage } from '@/pages/DocumentsPage'
import { InventoryPage } from '@/pages/InventoryPage'
import { KnowledgePage } from '@/pages/KnowledgePage'
import { MLModelsPage } from '@/pages/MLModelsPage'
import { OverviewPage } from '@/pages/OverviewPage'
import { ProductsPage } from '@/pages/ProductsPage'
import { PricingPage } from '@/pages/PricingPage'
import { ReplenishmentPage } from '@/pages/ReplenishmentPage'
import { WarehousesPage } from '@/pages/WarehousesPage'
import { PurchaseOrdersPage } from '@/pages/PurchaseOrdersPage'
import { RequestsPage } from '@/pages/RequestsPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { SuppliersPage } from '@/pages/SuppliersPage'

export interface NavItem {
  path: string
  label: string
  icon: LucideIcon
  /** Real page component. When omitted, the shared placeholder is rendered using `placeholder`. */
  component?: ComponentType
  placeholder?: { summary: string }
}

// Single source of truth for sidebar + routes. To ship a placeholder page later,
// set `component` and drop `placeholder`.
export const NAV_ITEMS: NavItem[] = [
  { path: '/overview', label: 'Overview', icon: LayoutDashboard, component: OverviewPage },
  { path: '/products', label: 'Products', icon: Package, component: ProductsPage },
  { path: '/suppliers', label: 'Suppliers', icon: Truck, component: SuppliersPage },
  { path: '/inventory', label: 'Inventory', icon: Warehouse, component: InventoryPage },
  { path: '/warehouses', label: 'Warehouses', icon: Building2, component: WarehousesPage },
  { path: '/replenishment', label: 'Replenishment', icon: PackageSearch, component: ReplenishmentPage },
  { path: '/pricing', label: 'Pricing & Breaks', icon: Tags, component: PricingPage },
  { path: '/purchase-orders', label: 'Purchase Orders', icon: ShoppingCart, component: PurchaseOrdersPage },
  { path: '/requests', label: 'Procurement Requests', icon: ClipboardList, component: RequestsPage },
  { path: '/documents', label: 'Documents', icon: FileText, component: DocumentsPage },
  { path: '/chatbots', label: 'AI Chatbots', icon: Bot, component: ChatbotsPage },
  { path: '/compare', label: 'Chatbot Comparison', icon: GitCompare, component: ComparePage },
  { path: '/knowledge', label: 'Knowledge Center', icon: Library, component: KnowledgePage },
  { path: '/agent', label: 'Agent Workspace', icon: Workflow, component: AgentPage },
  { path: '/ml', label: 'ML Models', icon: BrainCircuit, component: MLModelsPage },
  { path: '/ai-analytics', label: 'AI Analytics', icon: BarChart3, component: AIAnalyticsPage },
  { path: '/admin', label: 'AI Administration', icon: ShieldCheck, component: AdminPage },
  { path: '/settings', label: 'Settings', icon: Settings, component: SettingsPage },
]

/** Extra routes that are not sidebar items. */
export const EXTRA_ROUTES: { path: string; component: ComponentType }[] = [
  { path: '/chatbots/:slug', component: ChatPlaygroundPage },
]

export const DEFAULT_PATH = '/overview'
