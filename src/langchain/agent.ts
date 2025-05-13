import { ChatOpenAI } from "langchain/chat_models/openai";
import { 
  ChatPromptTemplate, 
  HumanMessagePromptTemplate, 
  SystemMessagePromptTemplate, 
  MessagesPlaceholder 
} from "langchain/prompts";
import { BufferMemory } from "langchain/memory";
import { AgentExecutor } from "langchain/agents";
import { DynamicTool } from "langchain/tools";
import prisma from '../services/db.service';
import { generateIdeaNFTImage, generateVisionNFTImage } from '../image-generation-service';
import { mintIdeaNft, mintVisionNft } from '../nft-service';
import { getNextLevelRequirements } from '../utils/discord.utils';
import { RunnableLambda, RunnableSequence } from "@langchain/core/runnables";
import { OpenAIFunctionsAgentOutputParser } from "langchain/agents/openai/output_parser";
import { formatForOpenAIFunctions } from "langchain/agents/format_scratchpad";
import { type AgentStep, type BaseMessage } from "langchain/schema";

// Define the tools for our agent to use

/**
 * Tool to get current project information
 */
const getProjectInfoTool = new DynamicTool({
  name: "getProjectInfo",
  description: "Get information about the current BioDAO project",
  func: async (projectId: string) => {
    try {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          members: {
            include: {
              bioUser: true,
            }
          },
          Discord: true,
          NFTs: true,
          Twitter: true,
        },
      });

      if (!project) {
        return `Project with ID ${projectId} not found`;
      }

      return JSON.stringify(project);
    } catch (error: any) { 
      console.error("Error getting project info:", error);
      return `Error: ${error.message}`;
    }
  },
});

/**
 * Tool to check level requirements
 */
const checkLevelRequirementsTool = new DynamicTool({
  name: "checkLevelRequirements",
  description: "Check if a project meets the requirements for the next level",
  func: async (projectId: string) => {
    try {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          Discord: true,
          NFTs: true,
          Twitter: true,
          members: {
            include: {
              bioUser: true,
            }
          },
        },
      });

      if (!project) {
        return `Project with ID ${projectId} not found`;
      }

      const currentLevel = project.level;
      let canLevelUp = false;
      let reason = "";
      let nextRequirements = getNextLevelRequirements(currentLevel);

      switch (currentLevel) {
        case 1:
          const hasIdeaNFT = project.NFTs.some(nft => nft.type === 'idea');
          const hasVisionNFT = project.NFTs.some(nft => nft.type === 'vision');
          canLevelUp = hasIdeaNFT && hasVisionNFT;
          if (!canLevelUp) {
            reason = `Missing NFTs: ${!hasIdeaNFT ? 'Idea NFT, ' : ''}${!hasVisionNFT ? 'Vision NFT' : ''}`.trim().replace(/,$/, '');
          }
          break;
          
        case 2:
          canLevelUp = !!(project.Discord && 
                      project.Discord.botAdded && 
                      project.Discord.memberCount &&
                      project.Discord.memberCount >= 4);
          if (!canLevelUp) {
            reason = !project.Discord 
              ? "Discord server not set up" 
              : !project.Discord.botAdded 
                ? "Bot not added to Discord server" 
                : `Discord server has ${project.Discord.memberCount || 0} members (need 4)`;
          }
          break;
          
        case 3:
          canLevelUp = !!(project.Discord && 
                      project.Discord.memberCount &&
                      project.Discord.memberCount >= 5 && 
                      project.Discord.papersShared >= 5 && 
                      project.Discord.messagesCount >= 50);
          if (!canLevelUp && project.Discord) {
            reason = `Current: ${project.Discord.memberCount || 0} members (need 5), ` +
                    `${project.Discord.papersShared || 0} papers (need 5), ` +
                    `${project.Discord.messagesCount || 0} messages (need 50)`;
          }
          break;
          
        case 4:
          canLevelUp = !!(project.Twitter && 
                      project.Twitter.connected && 
                      project.Twitter.introTweetsCount >= 3);
          if (!canLevelUp) {
            reason = !project.Twitter 
              ? "Twitter not connected" 
              : !project.Twitter.connected 
                ? "Twitter account not verified" 
                : `Only ${project.Twitter.introTweetsCount || 0} intro tweets (need 3)`;
          }
          break;
          
        case 5:
          const twitterSpaceHosted = !!(project.Twitter && project.Twitter.twitterSpaceUrl);
          canLevelUp = project.verifiedScientistCount >= 10 && twitterSpaceHosted;
          if (!canLevelUp) {
            reason = `${project.verifiedScientistCount || 0} verified scientists (need 10), ` +
                    `${twitterSpaceHosted ? 'Twitter Space hosted' : 'No Twitter Space hosted'}`;
          }
          break;
          
        case 6:
          const hasBlogpost = !!(project.Twitter && project.Twitter.blogpostUrl);
          const hasTwitterThread = !!(project.Twitter && project.Twitter.twitterThreadUrl);
          canLevelUp = hasBlogpost && hasTwitterThread;
          if (!canLevelUp) {
            reason = `${hasBlogpost ? 'Blogpost created' : 'No blogpost created'}, ` +
                    `${hasTwitterThread ? 'Twitter thread created' : 'No Twitter thread created'}`;
          }
          break;
          
        case 7:
          return JSON.stringify({ 
            currentLevel,
            nextLevel: null, 
            canLevelUp: false,
            reason: "Congratulations! You've already reached the maximum level!",
            nextRequirements: getNextLevelRequirements(currentLevel),
          });
      }

      return JSON.stringify({
        currentLevel,
        nextLevel: currentLevel < 7 ? currentLevel + 1 : null,
        canLevelUp,
        reason,
        nextRequirements,
      });
    } catch (error: any) { 
      console.error("Error checking level requirements:", error);
      return `Error: ${error.message}`;
    }
  },
});

/**
 * Tool to mint NFTs
 */
const mintNFTTool = new DynamicTool({
  name: "mintNFT",
  description: "Mint an NFT (idea or vision) for a project",
  func: async (input: string) => {
    try {
      const params = JSON.parse(input);
      const { projectId, nftType } = params;
      
      if (!projectId || !nftType) {
        return "Error: projectId and nftType are required";
      }
      
      if (nftType !== 'idea' && nftType !== 'vision') {
        return "Error: nftType must be 'idea' or 'vision'";
      }
      
      const existingNFT = await prisma.nFT.findFirst({
        where: {
          projectId,
          type: nftType,
        },
      });
      
      if (existingNFT) {
        return `${nftType.charAt(0).toUpperCase() + nftType.slice(1)} NFT already exists for this project`;
      }
      
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          members: {
            include: {
              bioUser: true,
            }
          },
        },
      });
      
      if (!project) {
        return `Project with ID ${projectId} not found`;
      }
      
      const wallet = project.members?.[0]?.bioUser?.wallet;
      if (!wallet) {
        return "No wallet address found for this project";
      }
      
      let transactionHash;
      const walletAddress = wallet as `0x${string}`; 
      
      if (nftType === 'idea') {
        transactionHash = await mintIdeaNft(walletAddress);
      } else {
        transactionHash = await mintVisionNft(walletAddress);
      }
      
      const nft = await prisma.nFT.create({
        data: {
          type: nftType,
          projectId,
          transactionHash,
        },
      });
      
      if (nftType === 'idea') {
        generateIdeaNFTImage(projectId, project.projectDescription || '')
          .then(imageUrl => {
            if(imageUrl) { 
              prisma.nFT.update({
                where: { id: nft.id },
                data: { imageUrl },
              });
            }
          }).catch(err => console.error("Error generating idea NFT image:", err));
      } else {
        generateVisionNFTImage(projectId, project.projectVision || '')
          .then(imageUrl => {
             if(imageUrl) { 
              prisma.nFT.update({
                where: { id: nft.id },
                data: { imageUrl },
              });
            }
          }).catch(err => console.error("Error generating vision NFT image:", err));
      }
      
      return `Successfully minted ${nftType} NFT for project ${projectId}`;
    } catch (error: any) { 
      console.error("Error minting NFT:", error);
      return `Error: ${error.message}`;
    }
  },
});

/**
 * Tool to perform level-up
 */
const levelUpProjectTool = new DynamicTool({
  name: "levelUpProject",
  description: "Level up a project to the next level if requirements are met",
  func: async (projectId: string) => {
    try {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          Discord: true,
          NFTs: true,
          Twitter: true,
          members: {
            include: {
              bioUser: true,
            }
          },
        },
      });

      if (!project) {
        return `Project with ID ${projectId} not found`;
      }

      const currentLevel = project.level;
      let canLevelUp = false;

      switch (currentLevel) {
        case 1:
          const hasIdeaNFT = project.NFTs.some(nft => nft.type === 'idea');
          const hasVisionNFT = project.NFTs.some(nft => nft.type === 'vision');
          canLevelUp = hasIdeaNFT && hasVisionNFT;
          break;
          
        case 2:
          canLevelUp = !!(project.Discord && 
                      project.Discord.botAdded && 
                      project.Discord.memberCount && 
                      project.Discord.memberCount >= 4);
          break;
          
        case 3:
          canLevelUp = !!(project.Discord && 
                      project.Discord.memberCount && 
                      project.Discord.memberCount >= 5 && 
                      project.Discord.papersShared >= 5 && 
                      project.Discord.messagesCount >= 50);
          break;
          
        case 4:
          canLevelUp = !!(project.Twitter && 
                      project.Twitter.connected && 
                      project.Twitter.introTweetsCount >= 3);
          break;
          
        case 5:
          const twitterSpaceHosted = !!(project.Twitter && project.Twitter.twitterSpaceUrl);
          canLevelUp = project.verifiedScientistCount >= 10 && twitterSpaceHosted;
          break;
          
        case 6:
          const hasBlogpost = !!(project.Twitter && project.Twitter.blogpostUrl);
          const hasTwitterThread = !!(project.Twitter && project.Twitter.twitterThreadUrl);
          canLevelUp = hasBlogpost && hasTwitterThread;
          break;
          
        case 7:
          return `Project ${projectId} is already at the maximum level (${currentLevel}).`; 
      }

      if (!canLevelUp) {
        return `Cannot level up project ${projectId} from level ${currentLevel} yet. Requirements not met.`;
      }

      const newLevel = currentLevel + 1;
      await prisma.project.update({
        where: { id: projectId },
        data: { level: newLevel },
      });

      return `Successfully leveled up project ${projectId} from level ${currentLevel} to level ${newLevel}!`;
    } catch (error: any) { 
      console.error("Error leveling up project:", error);
      return `Error: ${error.message}`;
    }
  },
});

/**
 * Tool to verify Twitter tweets
 */
const verifyTwitterTweetsTool = new DynamicTool({
  name: "verifyTwitterTweets",
  description: "Verify Twitter intro tweets for a project",
  func: async (input: string) => {
    try {
      const params = JSON.parse(input);
      const { projectId, tweetUrls } = params;
      
      if (!projectId) {
        return "Error: projectId is required";
      }
      
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: { Twitter: true },
      });
      
      if (!project?.Twitter) {
        return "Error: No Twitter account connected to this project";
      }
      
      if (!project.Twitter.connected) {
        return "Error: Twitter account is not verified";
      }
      
      if (tweetUrls && Array.isArray(tweetUrls) && tweetUrls.length > 0) {
        const tweetIds = tweetUrls.map(url => {
          const matches = url.match(/status\/(\d+)/);
          return matches?.[1] || null;
        }).filter(Boolean) as string[]; 
        
        if (tweetIds.length === 0) {
          return "No valid tweet IDs found in the provided URLs";
        }
        
        const currentCount = project.Twitter.introTweetsCount || 0;
        const newCount = Math.min(3, currentCount + tweetIds.length);
        
        await prisma.twitter.update({
          where: { projectId },
          data: {
            introTweetsCount: newCount,
            tweetIds: tweetIds.join(',') 
          },
        });
        
        return `Verified ${tweetIds.length} tweets. Total intro tweets: ${newCount}/3`;
      } else {
        return `Current intro tweets: ${project.Twitter.introTweetsCount || 0}/3`;
      }
    } catch (error: any) { 
      console.error("Error verifying Twitter tweets:", error);
      return `Error: ${error.message}`;
    }
  },
});

/**
 * Tool to verify Twitter Space
 */
const verifyTwitterSpaceTool = new DynamicTool({
  name: "verifyTwitterSpace",
  description: "Verify Twitter Space for a project",
  func: async (input: string) => {
    try {
      const params = JSON.parse(input);
      const { projectId, spaceUrl } = params;
      
      if (!projectId || !spaceUrl) {
        return "Error: projectId and spaceUrl are required";
      }
      
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: { Twitter: true },
      });
      
      if (!project?.Twitter) {
        return "Error: No Twitter account connected to this project";
      }
      
      if (!project.Twitter.connected) {
        return "Error: Twitter account is not verified";
      }
      
      if (!spaceUrl.includes('twitter.com/i/spaces/') && !spaceUrl.includes('x.com/i/spaces/')) {
        return "Error: Invalid Twitter Space URL format";
      }
      
      await prisma.twitter.update({
        where: { projectId },
        data: {
          twitterSpaceUrl: spaceUrl,
          twitterSpaceDate: new Date(),
        },
      });
      
      return `Successfully verified Twitter Space: ${spaceUrl}`;
    } catch (error: any) { 
      console.error("Error verifying Twitter Space:", error);
      return `Error: ${error.message}`;
    }
  },
});

/**
 * Tool to verify blogpost
 */
const verifyBlogpostTool = new DynamicTool({
  name: "verifyBlogpost",
  description: "Verify a blogpost for a project",
  func: async (input: string) => {
    try {
      const params = JSON.parse(input);
      const { projectId, blogpostUrl } = params;
      
      if (!projectId || !blogpostUrl) {
        return "Error: projectId and blogpostUrl are required";
      }
      
      try {
        new URL(blogpostUrl);
      } catch (e) {
        return "Error: Invalid URL format";
      }
      
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: { Twitter: true },
      });
      
      if (!project?.Twitter) {
        return "Error: No Twitter account connected to this project";
      }
      
      await prisma.twitter.update({
        where: { projectId },
        data: {
          blogpostUrl,
          blogpostDate: new Date(),
        },
      });
      
      return `Successfully verified blogpost: ${blogpostUrl}`;
    } catch (error: any) { 
      console.error("Error verifying blogpost:", error);
      return `Error: ${error.message}`;
    }
  },
});

/**
 * Tool to verify Twitter thread
 */
const verifyTwitterThreadTool = new DynamicTool({
  name: "verifyTwitterThread",
  description: "Verify a Twitter thread for a project",
  func: async (input: string) => {
    try {
      const params = JSON.parse(input);
      const { projectId, threadUrl } = params;
      
      if (!projectId || !threadUrl) {
        return "Error: projectId and threadUrl are required";
      }
      
      if (!threadUrl.includes('twitter.com/') && !threadUrl.includes('x.com/')) {
        return "Error: Invalid Twitter URL format";
      }
      
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: { Twitter: true },
      });
      
      if (!project?.Twitter) {
        return "Error: No Twitter account connected to this project";
      }
      
      if (!project.Twitter.blogpostUrl) {
        return "Error: Please verify your blogpost first before verifying your Twitter thread";
      }
      
      await prisma.twitter.update({
        where: { projectId },
        data: {
          twitterThreadUrl: threadUrl,
          twitterThreadDate: new Date(),
        },
      });
      
      return `Successfully verified Twitter thread: ${threadUrl}`;
    } catch (error: any) { 
      console.error("Error verifying Twitter thread:", error);
      return `Error: ${error.message}`;
    }
  },
});

const tools = [
  getProjectInfoTool,
  checkLevelRequirementsTool,
  mintNFTTool,
  levelUpProjectTool,
  verifyTwitterTweetsTool,
  verifyTwitterSpaceTool,
  verifyBlogpostTool,
  verifyTwitterThreadTool,
];

export function createLevelBasedSystemPrompt(level: number): string {
  const basePrompt = `You are CoreAgent, an AI assistant for BioDAO projects. Your purpose is to help BioDAO founders advance through levels of the onboarding process.

Current level: ${level}

You can help the user with:
- Understanding their current progress and requirements
- Minting NFTs
- Setting up their community on Discord
- Growing their community
- Establishing social presence on Twitter
- Documenting their vision
`;

  let levelGuidance = '';
  
  switch (level) {
    case 1:
      levelGuidance = `At Level 1, you need to guide the user to:
1. Mint their Idea NFT
2. Mint their Vision NFT
These NFTs represent their scientific concept and vision.`;
      break;
      
    case 2:
      levelGuidance = `At Level 2, you need to guide the user to:
1. Create a Discord server for their community
2. Install the verification bot
3. Grow their community to at least 4 members
You can provide tips on how to attract researchers and collaborators.`;
      break;
      
    case 3:
      levelGuidance = `At Level 3, you need to guide the user to grow their community with:
1. At least 5 Discord members
2. At least 5 scientific papers shared in Discord
3. At least 50 quality messages
These metrics help ensure they're building an engaged scientific community.`;
      break;
      
    case 4:
      levelGuidance = `At Level 4, you need to guide the user to establish their social presence:
1. Connect their Twitter account
2. Publish 3 introductory tweets about their DAO and its mission
Help them craft effective tweets that showcase their scientific focus.`;
      break;
      
    case 5:
      levelGuidance = `At Level 5, you need to guide the user to expand their scientific network:
1. Recruit and verify at least 10 scientists or patients to their community
2. Host a Twitter Space to engage their audience
These steps help establish their scientific credibility.`;
      break;
      
    case 6:
      levelGuidance = `At Level 6, you need to guide the user to articulate their long-term vision:
1. Write and publish a visionary blogpost about their DAO's future in 5-10 years
2. Convert their blogpost into a Twitter thread and share it publicly
This helps communicate their scientific mission to a broader audience.`;
      break;
      
    case 7:
      levelGuidance = `Congratulations! The user has reached Level 7, the highest level.
Guide them on how to continue growing their BioDAO community and scientific impact.
Provide suggestions on:
1. Regular community engagement
2. Funding opportunities
3. Scientific milestones and roadmap`;
      break;
  }

  return `${basePrompt}\n\n${levelGuidance}\n\nAlways be helpful, encouraging, and scientifically accurate. Guide the user step-by-step through the current level requirements.`;
}
 
const agentExecutors: Record<string, AgentExecutor> = {};

export async function createBioDAOAgent(projectId: string, level: number): Promise<AgentExecutor> {
  const agentKey = `${projectId}-${level}`;
  if (agentExecutors[agentKey]) {
    return agentExecutors[agentKey];
  }

  const llm = new ChatOpenAI({
    modelName: "gpt-4-turbo", 
    temperature: 0.2, 
  });

  const systemMessage = createLevelBasedSystemPrompt(level);

  const prompt = ChatPromptTemplate.fromMessages([
    SystemMessagePromptTemplate.fromTemplate(systemMessage),
    new MessagesPlaceholder("chat_history"),
    HumanMessagePromptTemplate.fromTemplate("{input}"),
    new MessagesPlaceholder("agent_scratchpad"), 
  ]);

  const memory = new BufferMemory({
    returnMessages: true,
    memoryKey: "chat_history",
    inputKey: "input", 
  });

  const llmWithTools = llm.bind({
    functions: tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties: {
          input: {
            type: "string",
            description: "the input to the tool"
          }
        },
        required: ["input"]
      }
    }))
  });

  const inputProcessor = RunnableLambda.from(
    (i: { input: string; intermediate_steps: AgentStep[]; chat_history: BaseMessage[] }) => ({
      input: i.input,
      agent_scratchpad: formatForOpenAIFunctions(i.intermediate_steps),
      chat_history: i.chat_history,
    })
  );

  // Simplest way to create the agent - use the output parser directly
  const outputParser = new OpenAIFunctionsAgentOutputParser();
  
  // Creating a mock agent that implements the required methods
  const agent = {
    invoke: async (input: any) => {
      const formattedInput = await inputProcessor.invoke(input);
      const promptResult = await prompt.invoke(formattedInput);
      const llmResult = await llmWithTools.invoke(promptResult);
      return outputParser.invoke(llmResult);
    }
  };

  const agentExecutor = new AgentExecutor({
    agent: agent as any,
    tools,
    memory, 
    verbose: process.env.NODE_ENV === 'development', 
    handleParsingErrors: true, 
  });

  agentExecutors[agentKey] = agentExecutor;
  return agentExecutor;
}

export async function processAgentMessage(userId: string, message: string, level: number) {
  try {
    const agentExecutor = await createBioDAOAgent(userId, level);
    
    const result = await agentExecutor.invoke({
      input: message,
    });
    
    return result.output as string; 
  } catch (error: any) { 
    console.error("Error processing agent message:", error);
    let errorMessage = "I'm sorry, I encountered an error processing your request. Please try again.";
    if (error.message) {
        errorMessage += ` Details: ${error.message}`;
    }
    return errorMessage;
  }
} 