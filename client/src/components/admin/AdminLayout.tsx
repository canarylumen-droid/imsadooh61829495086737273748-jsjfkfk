import { ReactNode, useState } from "react";
import { useLocation } from "wouter";
import {
  LayoutDashboard,
  Users,
  TrendingUp,
  Target,
  Settings,
  Shield,
  Menu,
  X
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

interface AdminLayoutProps {
  children: ReactNode;
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  const [location, setLocation] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navigation = [
    { name: "Overview", href: "/admin-secret-xyz", icon: LayoutDashboard },
    { name: "Users", href: "/admin-secret-xyz/users", icon: Users },
    { name: "Analytics", href: "/admin-secret-xyz/analytics", icon: TrendingUp },
    { name: "Leads", href: "/admin-secret-xyz/leads", icon: Target },
    { name: "Settings", href: "/admin-secret-xyz/settings", icon: Settings },
  ];

  const handleNavigate = (href: string) => {
    setLocation(href);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Admin Header */}
      <div className="border-b bg-card sticky top-0 z-40">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-b from-[#0d1428] via-[#0a0f1f] to-[#0d1428] p-1 rounded-lg">
                <img src="/logo.png" alt="audnixai.com" className="h-8 w-8 rounded-lg" />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-lg font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">audnixai.com</h1>
                <p className="text-xs text-muted-foreground">Admin Portal</p>
              </div>
            </div>

            {/* Mobile Menu Button */}
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild className="md:hidden">
                <Button variant="ghost" size="icon">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0">
                <nav className="space-y-1 p-4">
                  {navigation.map((item) => {
                    const isActive = location === item.href || (item.href !== "/admin-secret-xyz" && location.startsWith(item.href));
                    return (
                      <Button
                        key={item.name}
                        variant={isActive ? "secondary" : "ghost"}
                        className={cn("w-full justify-start", isActive && "bg-secondary")}
                        onClick={() => handleNavigate(item.href)}
                      >
                        <item.icon className="w-4 h-4 mr-2" />
                        {item.name}
                      </Button>
                    );
                  })}
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6">
        <div className="flex gap-6">
          {/* Sidebar Navigation - Desktop Only */}
          <aside className="hidden md:block w-64 shrink-0">
            <nav className="space-y-1">
              {navigation.map((item) => {
                const isActive = location === item.href || (item.href !== "/admin-secret-xyz" && location.startsWith(item.href));
                return (
                  <Button
                    key={item.name}
                    variant={isActive ? "secondary" : "ghost"}
                    className={cn(
                      "w-full justify-start",
                      isActive && "bg-secondary"
                    )}
                    onClick={() => handleNavigate(item.href)}
                  >
                    <item.icon className="w-4 h-4 mr-2" />
                    {item.name}
                  </Button>
                );
              })}
            </nav>
          </aside>

          {/* Main Content */}
          <main className="flex-1 w-full">
            <ScrollArea className="h-[calc(100vh-12rem)]">
              {children}
            </ScrollArea>
          </main>
        </div>
      </div>

      {/* Footer with Privacy Policy & Terms of Service */}
      <footer className="mt-auto py-6 border-t border-border/50">
        <div className="container mx-auto px-4 flex items-center justify-between text-sm text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} audnixai.com. All rights reserved.</p>
          <div className="flex space-x-4">
            <a href="/privacy-policy" className="hover:text-primary">Privacy Policy</a>
            <a href="/terms-of-service" className="hover:text-primary">Terms of Service</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
