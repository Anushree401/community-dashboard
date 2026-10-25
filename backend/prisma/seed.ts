import "dotenv/config";
import { hash } from "@node-rs/argon2";
import {
    AnnouncementStatus,
    CommunityVisibility,
    ContentStatus,
    MembershipRole,
    MembershipStatus,
} from "@prisma/client";
import prisma from "../src/lib/prisma";

const DEMO_PASSWORDS = {
    admin: "CEH_Admin_2026!",
    moderator: "CEH_Moderator_2026!",
    member: "CEH_Member_2026!",
    member2: "CEH_Member2_2026!",
} as const;

async function main() {
    console.log("Seeding CEH demo data...");

    // Hash once per account, then update existing demo accounts on reruns.
    const users = await Promise.all([
        prisma.user.upsert({
            where: { email: "admin@ceh.local" },
            update: {
                passwordHash: await hash(DEMO_PASSWORDS.admin),
                displayName: "CEH Admin",
                status: "ACTIVE",
            },
            create: {
                email: "admin@ceh.local",
                passwordHash: await hash(DEMO_PASSWORDS.admin),
                displayName: "CEH Admin",
                status: "ACTIVE",
            },
        }),
        prisma.user.upsert({
            where: { email: "moderator@ceh.local" },
            update: {
                passwordHash: await hash(DEMO_PASSWORDS.moderator),
                displayName: "CEH Moderator",
                status: "ACTIVE",
            },
            create: {
                email: "moderator@ceh.local",
                passwordHash: await hash(DEMO_PASSWORDS.moderator),
                displayName: "CEH Moderator",
                status: "ACTIVE",
            },
        }),
        prisma.user.upsert({
            where: { email: "member@ceh.local" },
            update: {
                passwordHash: await hash(DEMO_PASSWORDS.member),
                displayName: "CEH Member",
                status: "ACTIVE",
            },
            create: {
                email: "member@ceh.local",
                passwordHash: await hash(DEMO_PASSWORDS.member),
                displayName: "CEH Member",
                status: "ACTIVE",
            },
        }),
        prisma.user.upsert({
            where: { email: "member2@ceh.local" },
            update: {
                passwordHash: await hash(DEMO_PASSWORDS.member2),
                displayName: "CEH Member Two",
                status: "ACTIVE",
            },
            create: {
                email: "member2@ceh.local",
                passwordHash: await hash(DEMO_PASSWORDS.member2),
                displayName: "CEH Member Two",
                status: "ACTIVE",
            },
        }),
    ]);

    const [admin, moderator, member, member2] = users;

    const community = await prisma.community.upsert({
        where: { slug: "ceh-demo-community" },
        update: {
            name: "CEH Demo Community",
            description:
                "A sample community for testing posts, discussions, announcements, and engagement features.",
            visibility: CommunityVisibility.PUBLIC,
        },
        create: {
            name: "CEH Demo Community",
            slug: "ceh-demo-community",
            description:
                "A sample community for testing posts, discussions, announcements, and engagement features.",
            visibility: CommunityVisibility.PUBLIC,
            createdById: admin.id,
        },
    });

    const memberships = [
        { userId: admin.id, role: MembershipRole.COMMUNITY_ADMIN },
        { userId: moderator.id, role: MembershipRole.MODERATOR },
        { userId: member.id, role: MembershipRole.MEMBER },
        { userId: member2.id, role: MembershipRole.MEMBER },
    ];

    for (const membership of memberships) {
        await prisma.communityMembership.upsert({
            where: {
                communityId_userId: {
                    communityId: community.id,
                    userId: membership.userId,
                },
            },
            update: {
                role: membership.role,
                status: MembershipStatus.ACTIVE,
            },
            create: {
                communityId: community.id,
                userId: membership.userId,
                role: membership.role,
                status: MembershipStatus.ACTIVE,
            },
        });
    }

    let topic = await prisma.topic.findFirst({
        where: {
            communityId: community.id,
            name: "General Discussion",
        },
    });

    if (!topic) {
        topic = await prisma.topic.create({
            data: {
                communityId: community.id,
                name: "General Discussion",
                description: "Introductions, questions, and community discussions.",
                createdById: admin.id,
            },
        });
    }

    const postOne = await prisma.post.upsert({
        where: {
            id: "10000000-0000-4000-8000-000000000001",
        },
        update: {
            communityId: community.id,
            authorId: member.id,
            topicId: topic.id,
            title: "Welcome to the CEH Demo Community",
            body: "This sample post lets you test the community feed, post details, and comments.",
            status: ContentStatus.PUBLISHED,
        },
        create: {
            id: "10000000-0000-4000-8000-000000000001",
            communityId: community.id,
            authorId: member.id,
            topicId: topic.id,
            title: "Welcome to the CEH Demo Community",
            body: "This sample post lets you test the community feed, post details, and comments.",
            status: ContentStatus.PUBLISHED,
        },
    });

    await prisma.post.upsert({
        where: {
            id: "10000000-0000-4000-8000-000000000002",
        },
        update: {
            communityId: community.id,
            authorId: moderator.id,
            topicId: topic.id,
            title: "What would you like to see next?",
            body: "Share feature requests and ideas. Use this post to test reactions and community participation.",
            status: ContentStatus.PUBLISHED,
        },
        create: {
            id: "10000000-0000-4000-8000-000000000002",
            communityId: community.id,
            authorId: moderator.id,
            topicId: topic.id,
            title: "What would you like to see next?",
            body: "Share feature requests and ideas. Use this post to test reactions and community participation.",
            status: ContentStatus.PUBLISHED,
        },
    });

    await prisma.comment.upsert({
        where: {
            id: "20000000-0000-4000-8000-000000000001",
        },
        update: {
            postId: postOne.id,
            authorId: member2.id,
            body: "Looking forward to trying out the community features!",
            status: ContentStatus.PUBLISHED,
        },
        create: {
            id: "20000000-0000-4000-8000-000000000001",
            postId: postOne.id,
            authorId: member2.id,
            body: "Looking forward to trying out the community features!",
            status: ContentStatus.PUBLISHED,
        },
    });

    await prisma.announcement.upsert({
        where: {
            id: "30000000-0000-4000-8000-000000000001",
        },
        update: {
            communityId: community.id,
            authorId: admin.id,
            title: "Welcome and Demo Guide",
            body: "Use the demo accounts to test registration, login, community roles, posts, comments, and announcements.",
            status: AnnouncementStatus.PUBLISHED,
            publishedAt: new Date(),
        },
        create: {
            id: "30000000-0000-4000-8000-000000000001",
            communityId: community.id,
            authorId: admin.id,
            title: "Welcome and Demo Guide",
            body: "Use the demo accounts to test registration, login, community roles, posts, comments, and announcements.",
            status: AnnouncementStatus.PUBLISHED,
            publishedAt: new Date(),
        },
    });

    console.log("Seed completed.");
    console.log(`Community: ${community.name} (${community.slug})`);
    console.log(`Demo accounts created/updated: ${users.length}`);
}

main()
    .catch((error) => {
        console.error("Seed failed:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
