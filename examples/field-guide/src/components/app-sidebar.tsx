"use client";

import { BookOpenIcon, Globe2Icon, HouseIcon, KeyRoundIcon, LeafIcon, UserRoundIcon } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

const navigation = [
  { label: "Overview", href: "#overview", icon: HouseIcon },
  { label: "HTTP", href: "#http", icon: Globe2Icon },
  { label: "Identity", href: "#identity", icon: UserRoundIcon },
  { label: "Tokens", href: "#tokens", icon: KeyRoundIcon },
] as const;

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon" className="border-sidebar-border/80">
      <SidebarHeader className="px-3 py-5">
        <div className="flex items-center gap-3 px-1 text-primary">
          <LeafIcon aria-hidden="true" className="size-7 stroke-[1.4]" />
          <span className="font-display text-3xl group-data-[collapsible=icon]:hidden">Canopy</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-2">
              {navigation.map((item, index) => (
                <SidebarMenuItem key={item.label}>
                  <SidebarMenuButton render={<a href={item.href} />} isActive={index === 0} size="lg" tooltip={item.label}>
                    <item.icon aria-hidden="true" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <BookOpenIcon aria-hidden="true" className="size-5" />
          <span className="group-data-[collapsible=icon]:hidden">Field Guide v0.1</span>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
