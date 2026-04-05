import discord
from discord.ext import commands
from datetime import datetime

class Tooling(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.hybrid_command(name="serverinfo", description="Get detailed information about this server.")
    async def serverinfo(self, ctx):
        """Display server statistics and details."""
        guild = ctx.guild
        
        embed = discord.Embed(
            title=f"🏰 {guild.name} Status",
            color=discord.Color.blue(),
            timestamp=datetime.utcnow()
        )
        
        if guild.icon:
            embed.set_thumbnail(url=guild.icon.url)
            
        fields = [
            ("Owner", guild.owner.mention, True),
            ("Created", f"<t:{int(guild.created_at.timestamp())}:R>", True),
            ("Members", f"Total: `{guild.member_count}`", True),
            ("Channels", f"💬 {len(guild.text_channels)} | 🔊 {len(guild.voice_channels)}", True),
            ("Roles", f"`{len(guild.roles)}`", True),
            ("Boosts", f"Level `{guild.premium_tier}` | `{guild.premium_subscription_count}` boosts", True),
        ]
        
        for name, value, inline in fields:
            embed.add_field(name=name, value=value, inline=inline)
            
        embed.set_footer(text=f"Server ID: {guild.id}")
        await ctx.send(embed=embed)

    @commands.hybrid_command(name="userinfo", description="Get details about a member.")
    async def userinfo(self, ctx, member: discord.Member = None):
        """Show profile details for a user."""
        member = member or ctx.author
        
        embed = discord.Embed(
            title=f"👤 User Profile: {member.display_name}",
            color=member.top_role.color if member.top_role else discord.Color.light_grey(),
            timestamp=datetime.utcnow()
        )
        
        embed.set_thumbnail(url=member.display_avatar.url)
        
        roles = [role.mention for role in reversed(member.roles) if role.name != "@everyone"]
        roles_str = " ".join(roles) if roles else "No custom roles"
        
        fields = [
            ("Discord Joined", f"<t:{int(member.created_at.timestamp())}:D>", True),
            ("Server Joined", f"<t:{int(member.joined_at.timestamp())}:D>", True),
            ("ID", f"`{member.id}`", True),
            ("Top Role", member.top_role.mention if member.top_role else "None", True),
            (f"Roles ({len(roles)})", roles_str, False),
        ]
        
        for name, value, inline in fields:
            embed.add_field(name=name, value=value, inline=inline)
            
        await ctx.send(embed=embed)

    @commands.hybrid_command(name="membercount", description="Visual breakdown of server members.")
    async def membercount(self, ctx):
        """Quick summary of member stats."""
        guild = ctx.guild
        total = guild.member_count
        bots = len([m for m in guild.members if m.bot])
        humans = total - bots
        
        embed = discord.Embed(
            title="📊 Member Breakdown",
            color=discord.Color.teal()
        )
        
        embed.add_field(name="Humans", value=f"`{humans}`", inline=True)
        embed.add_field(name="Bots", value=f"`{bots}`", inline=True)
        embed.add_field(name="Total", value=f"`{total}`", inline=True)
        
        await ctx.send(embed=embed)

async def setup(bot):
    await bot.add_cog(Tooling(bot))
