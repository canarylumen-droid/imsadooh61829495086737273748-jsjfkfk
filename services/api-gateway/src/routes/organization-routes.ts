import { Router, Request, Response } from "express";
import { storage } from "@shared/lib/storage/storage.js";
import { requireAuthOrApiKey, getCurrentUserId } from "../middleware/auth.js";
import { insertOrganizationSchema, insertTeamMemberSchema } from "@audnix/shared";
import { z } from "zod";

const router = Router();

// GET /api/organizations - Get all organizations the current user belongs to
router.get("/", requireAuthOrApiKey, async (req: Request, res: Response) => {
    try {
        const userId = getCurrentUserId(req);
        const orgs = await storage.getUserOrganizations(userId!);
        res.json(orgs);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/organizations - Create a new organization
router.post("/", requireAuthOrApiKey, async (req: Request, res: Response) => {
    try {
        const userId = getCurrentUserId(req);
        const validatedData = insertOrganizationSchema.parse({
            ...req.body,
            ownerId: userId
        });

        const org = await storage.createOrganization(validatedData);

        // Add creator as admin
        await storage.addTeamMember({
            organizationId: org.id,
            userId: userId!,
            role: "admin"
        });

        res.status(201).json(org);
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.errors });
        }
        res.status(500).json({ error: error.message });
    }
});

// GET /api/organizations/:orgId/members - Get all members of an organization
router.get("/:orgId/members", requireAuthOrApiKey, async (req: Request, res: Response) => {
    try {
        const userId = getCurrentUserId(req);
        const { orgId } = req.params;

        // Verify user belongs to org
        const membership = await storage.getTeamMember(orgId as string, userId!);
        if (!membership) {
            return res.status(403).json({ error: "Access denied" });
        }

        const members = await storage.getOrganizationMembers(orgId as string);
        res.json(members);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/organizations/:orgId/members - Invite/Add a member to an organization
router.post("/:orgId/members", requireAuthOrApiKey, async (req: Request, res: Response) => {
    try {
        const adminId = getCurrentUserId(req);
        const { orgId } = req.params;
        const { email, role } = req.body;

        // Verify current user is admin of the org
        const membership = await storage.getTeamMember(orgId as string, adminId!);
        if (!membership || membership.role !== "admin") {
            return res.status(403).json({ error: "Only admins can add members" });
        }

        // Find user by email
        const userToInvite = await storage.getUserByEmail(email);
        if (!userToInvite) {
            return res.status(404).json({ error: "User with this email not found" });
        }

        // Check if already a member
        const existing = await storage.getTeamMember(orgId as string, userToInvite.id);
        if (existing) {
            return res.status(400).json({ error: "User is already a member" });
        }

        const newMember = await storage.addTeamMember({
            organizationId: orgId as string,
            userId: userToInvite.id,
            role: role || "member",
            invitedBy: adminId
        });

        res.status(201).json(newMember);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export const organizationRouter = router;
