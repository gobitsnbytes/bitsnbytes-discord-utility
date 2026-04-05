import discord
from discord.ext import commands
import asyncio

class Moderation(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.has_permissions(kick_members=True)
    @commands.hybrid_command(name="kick", description="Kick a member from the server.")
    async def kick(self, ctx, member: discord.Member, *, reason=None):
        """Kick a user with a reason."""
        reason = reason or "No reason provided."
        try:
            await member.kick(reason=reason)
            embed = discord.Embed(
                title="👢 User Kicked",
                description=f"**User:** {member.display_name} ({member.id})\n**Reason:** {reason}\n**Moderator:** {ctx.author}",
                color=discord.Color.red()
            )
            await ctx.send(embed=embed)
        except Exception as e:
            await ctx.send(f"❌ Failed to kick user: {e}")

    @commands.has_permissions(ban_members=True)
    @commands.hybrid_command(name="ban", description="Ban a member from the server.")
    async def ban(self, ctx, member: discord.Member, *, reason=None):
        """Ban a user with a reason."""
        reason = reason or "No reason provided."
        try:
            await member.ban(reason=reason)
            embed = discord.Embed(
                title="🔨 User Banned",
                description=f"**User:** {member.display_name} ({member.id})\n**Reason:** {reason}\n**Moderator:** {ctx.author}",
                color=discord.Color.dark_red()
            )
            await ctx.send(embed=embed)
        except Exception as e:
            await ctx.send(f"❌ Failed to ban user: {e}")

    @commands.has_permissions(manage_messages=True)
    @commands.hybrid_command(name="clear", description="Bulk delete messages.")
    async def clear(self, ctx, amount: int):
        """Clear a specified amount of messages."""
        if amount < 1:
            return await ctx.send("Please specify a number greater than 0.")
        
        await ctx.defer(ephemeral=True) # Avoid 'Interaction failed' on slow clears
        deleted = await ctx.channel.purge(limit=amount)
        
        embed = discord.Embed(
            title="🧹 Messages Cleared",
            description=f"Successfully deleted `{len(deleted)}` messages.",
            color=discord.Color.green()
        )
        await ctx.send(embed=embed, delete_after=5) # Auto-delete the confirmation message

    async def cog_command_error(self, ctx, error):
        if isinstance(error, commands.MissingPermissions):
            await ctx.send("🚫 You do not have permission to run this command.", delete_after=5)
        elif isinstance(error, commands.BadArgument):
            await ctx.send("❌ Invalid user or argument provided.", delete_after=5)

async def setup(bot):
    await bot.add_cog(Moderation(bot))
