import Analytics from './pages/Analytics';
import CRM from './pages/CRM';
import Companies from './pages/Companies';
import Dashboard from './pages/Dashboard';
import DealPipeline from './pages/DealPipeline';
import DealRecommendations from './pages/DealRecommendations';
import DueDiligence from './pages/DueDiligence';
import GroupStructure from './pages/GroupStructure';
import Home from './pages/Home';
import MarketAnalysis from './pages/MarketAnalysis';
import MergerSimulator from './pages/MergerSimulator';
import Scenarios from './pages/Scenarios';
import SubmitOpportunity from './pages/SubmitOpportunity';
import ScreeningBoard from './pages/ScreeningBoard';
import ThemeAdmin from './pages/ThemeAdmin';
import Settings from './pages/Settings';
import UserManagement from './pages/UserManagement';
import SuperAdmin from './pages/SuperAdmin';
import Portfolios from './pages/Portfolios';
import QandA from './pages/QandA';
import OpportunityRoute from './pages/OpportunityRoute';
import Reporting from './pages/Reporting';
import PipelineDashboard from './pages/PipelineDashboard';
import PipelineMetrics from './pages/PipelineMetrics';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Analytics": Analytics,
    "CRM": CRM,
    "Companies": Companies,
    "Dashboard": Dashboard,
    "DealPipeline": DealPipeline,
    "DealRecommendations": DealRecommendations,
    "DueDiligence": DueDiligence,
    "GroupStructure": GroupStructure,
    "Home": Home,
    "MarketAnalysis": MarketAnalysis,
    "MergerSimulator": MergerSimulator,
    "Scenarios": Scenarios,
    "SubmitOpportunity": SubmitOpportunity,
    "ScreeningBoard": ScreeningBoard,
    "ThemeAdmin": ThemeAdmin,
    "Settings": Settings,
    "UserManagement": UserManagement,
    "SuperAdmin": SuperAdmin,
    "Portfolios": Portfolios,
    "QandA": QandA,
    "OpportunityRoute": OpportunityRoute,
    "Reporting": Reporting,
    "PipelineDashboard": PipelineDashboard,
    "PipelineMetrics": PipelineMetrics,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};
