// Routable pages. Phase 1 scope follows DealForge_Phase1_BRD_v2.
//
// Later-phase pages are kept in the code but switched OFF by default in
// server/config/featureFlags.js, so they disappear from the menu and routes
// until an admin turns them on (Settings > Features) or FEATURE_FLAGS lists them:
//   - DueDiligence: Gate 3 diligence (BRD WF-09, Phase 2)
//   - Portfolios: post-investment tracking (BRD DSH-05, Phase 4)
//
// Dashboard is not a Phase 1 screen and is no longer in the menu or the landing
// page. It stays routable only because it is the PLT-06 RTL demonstration
// screen (server/config/i18nData.js RTL_DEMO_SCREEN) until that demo moves to a
// Phase 1 screen.
import Dashboard from './pages/Dashboard';
import DueDiligence from './pages/DueDiligence';
import GroupStructure from './pages/GroupStructure';
import SubmitOpportunity from './pages/SubmitOpportunity';
import ScreeningBoard from './pages/ScreeningBoard';
import ThemeAdmin from './pages/ThemeAdmin';
import Settings from './pages/Settings';
import SuperAdmin from './pages/SuperAdmin';
import Portfolios from './pages/Portfolios';
import QandA from './pages/QandA';
import OpportunityRoute from './pages/OpportunityRoute';
import Reporting from './pages/Reporting';
import PipelineDashboard from './pages/PipelineDashboard';
import PipelineMetrics from './pages/PipelineMetrics';
import MyWork from './pages/MyWork';
import Opportunity from './pages/Opportunity';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Dashboard": Dashboard,
    "DueDiligence": DueDiligence,
    "GroupStructure": GroupStructure,
    "SubmitOpportunity": SubmitOpportunity,
    "ScreeningBoard": ScreeningBoard,
    "ThemeAdmin": ThemeAdmin,
    "Settings": Settings,
    "SuperAdmin": SuperAdmin,
    "Portfolios": Portfolios,
    "QandA": QandA,
    "OpportunityRoute": OpportunityRoute,
    "Reporting": Reporting,
    "PipelineDashboard": PipelineDashboard,
    "PipelineMetrics": PipelineMetrics,
    "MyWork": MyWork,
    "Opportunity": Opportunity,
}

export const pagesConfig = {
    // Every role lands on My Work (EXP-02): what is waiting on them. The
    // Opportunity 360 page (EXP-01) is routable but not in the menu.
    mainPage: "MyWork",
    Pages: PAGES,
    Layout: __Layout,
};
