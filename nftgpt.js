// completeNFTGenerationSystem.js
import { Sr25519Account } from "@unique-nft/sr25519";
import { Sdk } from '@unique-nft/sdk/full';
import FormData from 'form-data';
import OpenAI from 'openai';
import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { initializeApp } from "firebase/app";
import { getStorage } from "firebase/storage";

// Hard-coded configuration

const getSdk = () => {
    const account = Sr25519Account.fromUri(MNEMONIC);
    const sdk = new Sdk({
        baseUrl: UNIQUE_NETWORK_BASE_URL,
        account,
    });

    return { sdk, account };
};

async function generateCustomAttributes(description) {
    const prompt = `Given the following NFT description, generate a JSON object with custom attributes. The attributes should be creative and relevant to the description. Include at least 5 attributes.

    NFT Description: ${description}

    Generate a JSON object in the following format:
    {
        "attributes": [
            {
                "trait_type": "AttributeName",
                "value": "AttributeValue"
            },
            ...
        ]
    }`;

    const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
    });

    return response.choices[0].message.content;
}

async function generateImage(description) {
    try {
        const response = await openai.images.generate({
            model: "dall-e-3",
            prompt: `Create a detailed and visually striking image for an NFT based on this description: ${description}`,
            n: 1,
            size: '1024x1024',
        });

        return response.data[0].url;
    } catch (error) {
        console.error('Error generating image:', error);
        throw error;
    }
}

async function pinFileToIPFS(filePath) {
    try {
        const data = new FormData();
        data.append('file', fs.createReadStream(filePath));

        const pinataResponse = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${PINATA_JWT}`,
            },
            body: data,
        });

        const result = await pinataResponse.json();
        return result.IpfsHash;
    } catch (error) {
        console.error('Error in pinFileToIPFS:', error);
        throw error;
    }
}

async function validateGPTResponse(response, description, attempt = 1) {
    const maxAttempts = 10;

    try {
        const parsedResponse = JSON.parse(response);
        if (parsedResponse.attributes && Array.isArray(parsedResponse.attributes)) {
            return parsedResponse;
        }
    } catch (error) {
        console.error(`Invalid JSON format (Attempt ${attempt}/${maxAttempts}):`, error.message);
    }

    if (attempt < maxAttempts) {
        console.log(`Retrying GPT request (Attempt ${attempt + 1}/${maxAttempts})...`);
        const newResponse = await generateCustomAttributes(description);
        return validateGPTResponse(newResponse, description, attempt + 1);
    } else {
        throw new Error('Failed to get valid JSON response from GPT after 10 attempts');
    }
}

async function mintNFT(description, ownerAddress) {
    const { account, sdk } = getSdk();

    try {
        // Generate custom attributes
        console.log("Generating custom attributes...");
        const customAttributesResponse = await generateCustomAttributes(description);
        const validatedAttributes = await validateGPTResponse(customAttributesResponse, description);

        console.log("Generating image...");
        const imageUrl = await generateImage(description);
        if (!imageUrl) {
            throw new Error('Failed to generate image');
        }
        console.log("Image generated:", imageUrl);

        console.log("Downloading image...");
        const imageResponse = await fetch(imageUrl);
        const imageBuffer = await imageResponse.buffer();

        // Save the image locally
        const tempDir = path.join(process.cwd(), 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir);
        }
        const localImagePath = path.join(tempDir, `nft_image_${uuidv4()}.png`);
        fs.writeFileSync(localImagePath, imageBuffer);

        console.log("Uploading image to IPFS...");
        const imageCid = await pinFileToIPFS(localImagePath);
        console.log("Image uploaded to IPFS. CID:", imageCid);

        // Clean up the temporary file
        fs.unlinkSync(localImagePath);

        // Prepare attributes for minting
        const attributes = validatedAttributes.attributes.map(attr => ({
            trait_type: attr.trait_type,
            value: attr.value.toString()
        }));

        // Mint the NFT
        console.log("Minting NFT...");
        const mintResult = await sdk.token.createV2({
            collectionId: COLLECTION_ID,
            image: `${PINATA_GATEWAY}/ipfs/${imageCid}`,
            owner: ownerAddress,
            attributes: attributes
        });

        console.log("NFT minted successfully");
        return mintResult.parsed;
    } catch (error) {
        console.log("ERROR in mintNFT:", error);
        throw error;
    }
}

function promptUser() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question('Please enter a description for your NFT: ', (description) => {
            rl.question('Please enter the owner\'s address: ', (ownerAddress) => {
                rl.close();
                resolve({ description, ownerAddress });
            });
        });
    });
}

async function main() {
    try {
        const { description, ownerAddress } = await promptUser();

        console.log('Starting NFT generation and minting process...');
        
        const result = await mintNFT(description, ownerAddress);
        
        console.log('NFT created successfully!');
        console.log('NFT Details:', result);
    } catch (error) {
        console.error('An error occurred:', error.message);
    }
}

main();